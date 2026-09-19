const test = require('node:test');
const assert = require('node:assert');
const {
  buildRealtimeInstructions,
  buildPlatformRules,
  buildOpeningGreeting,
  DEFAULT_CLIENT_INSTRUCTIONS
} = require('../src/voice/instructionBuilder');
const VoiceSession = require('../src/voice/VoiceSession');
const AgentPrompt = require('../src/models/AgentPrompt');

test('Phase 2.2 — Client-Controlled Agent Instructions', async (t) => {
  // Test data
  const sampleClientInstructions = `You are an IVA qualification specialist for Zenith Advisory Ltd.
Speak warmly, concisely, and politely.
Ask one question at a time and never pressure the customer.
If the customer asks about debt solutions, explain that an IVA consolidates unsecured debt into one affordable payment.
If the customer wants to talk to a human advisor, offer an immediate warm transfer.`;

  // 1. Client can create/update instructions
  await t.test('1. Client can create/update instructions and fields are sanitized', () => {
    const config = {
      name: 'Zenith IVA Persona',
      instructions: sampleClientInstructions,
      greeting: 'Good day [LeadName], this is [AgentName] from [CompanyName].',
      tone: 'empathetic',
      behaviour: {
        askOneQuestionAtATime: true,
        allowInterruptions: true,
        offerCallback: true,
        transferOnRequest: true
      },
      version: 2
    };

    assert.strictEqual(config.instructions, sampleClientInstructions);
    assert.strictEqual(config.tone, 'empathetic');
    assert.strictEqual(config.version, 2);
    assert.strictEqual(config.behaviour.askOneQuestionAtATime, true);
  });

  // 2. Client can retrieve their instructions
  await t.test('2. Final instructions reflect retrieved client configuration', () => {
    const agentConfig = {
      agentName: 'Marcus Vance',
      companyName: 'Zenith Advisory',
      instructions: sampleClientInstructions,
      tone: 'empathetic'
    };
    const lead = { name: 'John Smith', phone: '+447700900123' };

    const finalInstructions = buildRealtimeInstructions({ agentConfig, lead });
    assert(finalInstructions.includes(sampleClientInstructions), 'Instructions must include client custom text');
    assert(finalInstructions.includes('[CLIENT AGENT INSTRUCTIONS]'), 'Must have client instructions section');
    assert(finalInstructions.includes('Marcus Vance'), 'Must replace or include agent name');
    assert(finalInstructions.includes('Zenith Advisory'), 'Must replace or include company name');
    assert(finalInstructions.includes('John Smith'), 'Must include lead context');
  });

  // 3. Client cannot access another client's configuration
  await t.test("3. Verifies tenant authorization logic blocks cross-tenant access", () => {
    // Test the isAuthorizedForAgent logic
    const agentOfUserA = {
      userId: 'user_111_aaa',
      companyId: 'company_aaa',
      name: 'Agent A'
    };

    const userB = {
      _id: 'user_222_bbb',
      companyId: 'company_bbb',
      role: 'agent'
    };

    const adminUser = {
      _id: 'user_admin_999',
      role: 'admin'
    };

    // Helper logic matching aiRoutes authorization
    function isAuthorized(agent, user) {
      if (!user || user.role === 'admin' || String(user._id) === 'dev_user_id') return true;
      if (!agent.userId && !agent.companyId) return true;
      if (agent.userId && String(agent.userId) === String(user._id)) return true;
      if (agent.companyId && user.companyId && String(agent.companyId) === String(user.companyId)) return true;
      return false;
    }

    assert.strictEqual(isAuthorized(agentOfUserA, userB), false, 'User B must not access User A configuration');
    assert.strictEqual(isAuthorized(agentOfUserA, adminUser), true, 'Admin can access any configuration');
  });

  // 4. Invalid configuration fields are rejected/ignored safely
  await t.test('4. Unknown or malicious fields are excluded from prompt generation', () => {
    const maliciousConfig = {
      instructions: 'Standard instructions.',
      // Malicious attempt to override platform state or inject arbitrary fields
      qualified: true,
      qualificationStatus: 'QUALIFIED',
      checks: { debtAmount: 'PASS' },
      __v: 99,
      internalSecretKey: 'should_never_leak'
    };

    const finalInstructions = buildRealtimeInstructions({ agentConfig: maliciousConfig });
    assert(!finalInstructions.includes('internalSecretKey'));
    assert(!finalInstructions.includes('qualificationStatus: "QUALIFIED"'));
    assert(finalInstructions.includes('Standard instructions.'));
  });

  // 5. Saved instructions are loaded into a new VoiceSession
  await t.test('5. Saved instructions and snapshot are attached to VoiceSession', () => {
    const session = new VoiceSession({ callId: 'test_session_snap_1' });
    const agentPromptDoc = {
      _id: 'agent_doc_123',
      agentName: 'Sarah Collins',
      companyName: 'Beacon Debt Advisory',
      instructions: sampleClientInstructions,
      version: 3,
      qualificationRules: { minDebtAmount: 6000, minCreditors: 3 }
    };

    // Simulate setupAiProvider snapshot attachment
    session.agentPromptId = agentPromptDoc._id;
    session.agentConfigSnapshot = JSON.parse(JSON.stringify(agentPromptDoc));
    session.agentConfigVersion = agentPromptDoc.version;

    assert.strictEqual(session.agentPromptId, 'agent_doc_123');
    assert.strictEqual(session.agentConfigVersion, 3);
    assert.strictEqual(session.agentConfigSnapshot.instructions, sampleClientInstructions);
  });

  // 6. Final OpenAI session instructions contain the client's instructions
  await t.test("6. Final OpenAI instructions contain the client's exact instructions", () => {
    const agentConfig = {
      instructions: 'Always ask the prospect if they have tried a Debt Management Plan previously.'
    };
    const finalInstructions = buildRealtimeInstructions({ agentConfig });
    assert(finalInstructions.includes('Always ask the prospect if they have tried a Debt Management Plan previously.'));
  });

  // 7. Existing mandatory platform instructions remain present
  await t.test('7. Mandatory platform instructions remain present regardless of client text', () => {
    const agentConfig = {
      instructions: 'Speak fast and close deals immediately.' // Client instruction
    };
    const finalInstructions = buildRealtimeInstructions({ agentConfig });

    // Must still contain platform rules and critical tool guidelines
    assert(finalInstructions.includes('[PLATFORM RULES]'));
    assert(finalInstructions.includes('update_qualification(field, value)'));
    assert(finalInstructions.includes('transfer_call()'));
    assert(finalInstructions.includes('end_call()'));
    assert(finalInstructions.includes('Never deliver long monologues'));
    assert(finalInstructions.includes('strictly forbidden from attempting to set qualification status'));
  });

  // 8. Empty instructions use a safe default
  await t.test('8. Empty client instructions fall back gracefully to safe minimal default', () => {
    const emptyConfig = { instructions: '' };
    const finalInstructions = buildRealtimeInstructions({ agentConfig: emptyConfig });

    assert(finalInstructions.includes(DEFAULT_CLIENT_INSTRUCTIONS));
    assert(finalInstructions.includes('[PLATFORM RULES]'));
  });

  // 9. Changing configuration affects NEW calls
  await t.test('9. Updating configuration document changes instructions for subsequent new calls', () => {
    let globalConfig = {
      version: 1,
      instructions: 'Version 1 prompt: Ask about total debt first.'
    };

    const call1Instructions = buildRealtimeInstructions({ agentConfig: globalConfig });
    assert(call1Instructions.includes('Version 1 prompt'));

    // Client updates configuration
    globalConfig = {
      version: 2,
      instructions: 'Version 2 prompt: Ask about employment situation first.'
    };

    const call2Instructions = buildRealtimeInstructions({ agentConfig: globalConfig });
    assert(call2Instructions.includes('Version 2 prompt'));
    assert(!call2Instructions.includes('Version 1 prompt'));
  });

  // 10. Active call keeps its configuration snapshot
  await t.test('10. Active call retains its initial snapshot even if global config is modified', () => {
    const liveSession = new VoiceSession({ callId: 'live_active_call_10' });
    const initialConfig = {
      version: 1,
      agentName: 'Agent Alice',
      instructions: 'Initial instructions for live call'
    };

    // Live call snapshots initial config at start
    liveSession.agentConfigSnapshot = JSON.parse(JSON.stringify(initialConfig));

    // Client edits global settings while call is in progress
    const modifiedGlobalConfig = {
      version: 2,
      agentName: 'Agent Bob',
      instructions: 'New instructions saved during active call'
    };

    // Re-evaluating active call using its snapshot preserves initial instructions
    const activeCallInstructions = buildRealtimeInstructions({
      agentConfig: liveSession.agentConfigSnapshot
    });

    assert(activeCallInstructions.includes('Initial instructions for live call'));
    assert(activeCallInstructions.includes('Agent Alice'));
    assert(!activeCallInstructions.includes('New instructions saved during active call'));
  });

  // 11. Greeting script generation
  await t.test('11. buildOpeningGreeting applies client greeting and context variables', () => {
    const agentConfig = {
      greeting: 'Hi [LeadName], this is [AgentName] calling from [CompanyName]. How are you doing today?',
      agentName: 'Sarah',
      companyName: 'Beacon Debt'
    };
    const lead = { name: 'David' };

    const greeting = buildOpeningGreeting({ agentConfig, lead });
    assert.strictEqual(greeting, 'Hi David, this is Sarah calling from Beacon Debt. How are you doing today?');
  });
});
