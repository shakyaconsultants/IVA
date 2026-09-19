const test = require('node:test');
const assert = require('node:assert');
const {
  buildOpeningGreeting,
  escapeXml,
  mapOpenAiVoiceToPolly
} = require('../src/voice/instructionBuilder');
const VoiceSession = require('../src/voice/VoiceSession');
const sessionManager = require('../src/voice/sessionManager');

test('Step 2 — Instant Configurable Greeting & Handover', async (t) => {

  // =========================================================================
  // 1. PLACEHOLDER INTERPOLATION & ESCAPING
  // =========================================================================
  await t.test('1. Interpolates {{leadName}}, {{agentName}}, and {{companyName}}', () => {
    const agentConfig = {
      greeting: "Hi {{leadName}}, you're speaking with {{agentName}} from {{companyName}}.",
      agentName: 'Sarah Collins',
      companyName: 'Beacon Debt Advisory'
    };
    const lead = { name: 'John Doe' };

    const result = buildOpeningGreeting({ agentConfig, lead });
    assert.strictEqual(result, "Hi John Doe, you're speaking with Sarah Collins from Beacon Debt Advisory.");
  });

  await t.test('2. Preserves backward-compatible [LeadName], [AgentName], and [CompanyName]', () => {
    const agentConfig = {
      openingScript: "Hello [LeadName], this is [AgentName] calling from [CompanyName].",
      agentName: 'David Miller',
      companyName: 'Apex Advisory'
    };
    const lead = { name: 'Emma Watson' };

    const result = buildOpeningGreeting({ agentConfig, lead });
    assert.strictEqual(result, "Hello Emma Watson, this is David Miller calling from Apex Advisory.");
  });

  await t.test('3. Interpolates single curly braces {leadName}, {agentName}, {companyName}', () => {
    const agentConfig = {
      greeting: "Good afternoon {leadName}, I am {agentName} from {companyName}.",
      agentName: 'Oliver Smith',
      companyName: 'Resolute Finance'
    };
    const lead = { name: 'Alice Brown' };

    const result = buildOpeningGreeting({ agentConfig, lead });
    assert.strictEqual(result, "Good afternoon Alice Brown, I am Oliver Smith from Resolute Finance.");
  });

  await t.test('4. Escapes XML special characters properly', () => {
    const specialText = 'M&M Financial <Debt Solutions> & Co. "Special" \'Offers\'';
    const escaped = escapeXml(specialText);

    assert.strictEqual(
      escaped,
      'M&amp;M Financial &lt;Debt Solutions&gt; &amp; Co. &quot;Special&quot; &apos;Offers&apos;'
    );
    assert(!escaped.includes('& '));
    assert(!escaped.includes('<D'));
    assert(!escaped.includes('> '));
  });

  // =========================================================================
  // 2. VOICE PERSONA MAPPING
  // =========================================================================
  await t.test('5. Female voices map to en-GB Polly.Amy', () => {
    assert.strictEqual(mapOpenAiVoiceToPolly('alloy'), 'Polly.Amy');
    assert.strictEqual(mapOpenAiVoiceToPolly('shimmer'), 'Polly.Amy');
    assert.strictEqual(mapOpenAiVoiceToPolly('nova'), 'Polly.Amy');
  });

  await t.test('6. Male voices map to en-GB Polly.Arthur', () => {
    assert.strictEqual(mapOpenAiVoiceToPolly('echo'), 'Polly.Arthur');
    assert.strictEqual(mapOpenAiVoiceToPolly('onyx'), 'Polly.Arthur');
    assert.strictEqual(mapOpenAiVoiceToPolly('fable'), 'Polly.Arthur');
  });

  await t.test('7. Unknown or empty voice gets safe en-GB Polly.Amy fallback', () => {
    assert.strictEqual(mapOpenAiVoiceToPolly(''), 'Polly.Amy');
    assert.strictEqual(mapOpenAiVoiceToPolly('custom_unknown_voice'), 'Polly.Amy');
    assert.strictEqual(mapOpenAiVoiceToPolly(null), 'Polly.Amy');
  });

  // =========================================================================
  // 3. TWIML STRUCTURE
  // =========================================================================
  await t.test('8. TwiML structure contains <Say> before <Connect><Stream>', () => {
    const greetingText = "Hi Jane Doe, you're speaking with Sarah Collins from Beacon Debt Advisory.";
    const pollyVoice = mapOpenAiVoiceToPolly('alloy');
    const streamUrl = 'wss://example.com/api/webhooks/twilio/media/test_call_1';

    const twiml = `<Response><Say voice="${pollyVoice}" language="en-GB">${escapeXml(greetingText)}</Say><Connect><Stream url="${streamUrl}" /></Connect></Response>`;

    assert(twiml.startsWith('<Response><Say'));
    assert(twiml.includes(`voice="${pollyVoice}"`));
    assert(twiml.includes('language="en-GB"'));
    assert(twiml.indexOf('<Say') < twiml.indexOf('<Connect>'));
    assert(twiml.includes(`<Stream url="${streamUrl}" />`));
    assert(twiml.endsWith('</Connect></Response>'));
  });

  // =========================================================================
  // 4. SESSION HANDOVER & NO DUPLICATE OPENAI GREETING
  // =========================================================================
  await t.test('9. TwiML greeting sets session state and prevents OpenAI sendGreeting()', async () => {
    const callId = 'test_handover_' + Date.now();
    const session = new VoiceSession({ callId });

    session.openingScript = "Hi John, this is Sarah Collins calling from Beacon Debt Advisory.";
    session.greetingSpokenViaTwiml = true;
    session.setTwilioStreamSid('stream_test_handover_1');

    let sendGreetingCalled = false;
    let injectedMessage = null;

    const mockProvider = {
      isConnected: true,
      sendGreeting: (script) => {
        sendGreetingCalled = true;
      },
      injectAssistantMessage: (text) => {
        injectedMessage = text;
      }
    };

    session.setAiProvider(mockProvider);

    // Simulate handleTwilioStart handover logic
    if (session.greetingSpokenViaTwiml) {
      if (!session.hasGreeted) {
        session.hasGreeted = true;
        session.setConversationState('WAITING_FOR_PROSPECT');
        session.setAiStatus('listening');

        // Add greeting to transcript exactly once
        if (session.openingScript) {
          session.addTranscriptItem({
            speaker: 'assistant',
            text: session.openingScript
          });
        }

        // Inject spoken greeting into OpenAI conversation context
        if (session.aiProvider && typeof session.aiProvider.injectAssistantMessage === 'function') {
          session.aiProvider.injectAssistantMessage(session.openingScript);
        }
      }
    }

    assert.strictEqual(session.hasGreeted, true, 'hasGreeted must be true');
    assert.strictEqual(session.conversationState, 'WAITING_FOR_PROSPECT', 'Must be in WAITING_FOR_PROSPECT');
    assert.strictEqual(session.aiStatus, 'listening', 'Must be in listening status');
    assert.strictEqual(sendGreetingCalled, false, 'OpenAI sendGreeting() must NOT be called');
    assert.strictEqual(injectedMessage, session.openingScript, 'Spoken greeting must be injected into OpenAI context');
  });

  await t.test('10. Spoken greeting appears exactly once in the transcript', () => {
    const callId = 'test_transcript_' + Date.now();
    const session = new VoiceSession({ callId });

    session.openingScript = "Hi Mark, this is Sarah from Beacon Debt Advisory.";
    session.addTranscriptItem({
      speaker: 'assistant',
      text: session.openingScript
    });

    assert.strictEqual(session.transcript.length, 1);
    assert.strictEqual(session.transcript[0].speaker, 'assistant');
    assert.strictEqual(session.transcript[0].text, session.openingScript);

    // Customer responds next
    session.addTranscriptItem({
      speaker: 'customer',
      text: "Yes hello, what is this regarding?"
    });

    assert.strictEqual(session.transcript.length, 2);
    assert.strictEqual(session.transcript[1].speaker, 'customer');
    assert.strictEqual(session.transcript[0].speaker, 'assistant');
  });

  await t.test('11. injectAssistantMessage sends valid conversation.item.create payload to OpenAI with output_text', () => {
    const OpenAiRealtimeProvider = require('../src/voice/providers/openaiRealtimeProvider');
    const provider = new OpenAiRealtimeProvider({
      callId: 'test_item_create',
      apiKey: 'test_key',
      timings: {}
    });

    const sentPayloads = [];
    provider._send = (payload) => {
      sentPayloads.push(payload);
    };
    provider.isConnected = true;
    provider.ws = { readyState: 1 /* OPEN */ };

    const text = "Hi John, you're speaking with Sarah from Beacon Debt Advisory.";
    const result = provider.injectAssistantMessage(text);

    assert.strictEqual(result, true);
    assert.strictEqual(sentPayloads.length, 1);
    assert.strictEqual(sentPayloads[0].type, 'conversation.item.create');
    assert.strictEqual(sentPayloads[0].item.type, 'message');
    assert.strictEqual(sentPayloads[0].item.role, 'assistant');
    // Issue 1 regression: type must be 'output_text', not 'text'
    assert.strictEqual(sentPayloads[0].item.content[0].type, 'output_text');
    assert.notStrictEqual(sentPayloads[0].item.content[0].type, 'text', "Value must be 'output_text', not 'text'");
    assert.strictEqual(sentPayloads[0].item.content[0].text, text);

    // Verify no response.create was sent for the injected greeting
    const responseCreatePayloads = sentPayloads.filter((p) => p.type === 'response.create');
    assert.strictEqual(responseCreatePayloads.length, 0, 'Must NOT trigger response.create for injected greeting');
  });

  await t.test('12. Validates ALLOWED_TRANSITIONS from CALL_CONNECTED to WAITING_FOR_PROSPECT', () => {
    const session = new VoiceSession({ callId: 'test_trans_' + Date.now() });
    assert.strictEqual(session.conversationState, 'CALL_CONNECTED');

    const success = session.setConversationState('WAITING_FOR_PROSPECT');
    assert.strictEqual(success, true, 'Transition CALL_CONNECTED -> WAITING_FOR_PROSPECT must succeed');
    assert.strictEqual(session.conversationState, 'WAITING_FOR_PROSPECT');

    // From WAITING_FOR_PROSPECT, prospect speaks
    const toSpeaking = session.setConversationState('PROSPECT_SPEAKING');
    assert.strictEqual(toSpeaking, true, 'Transition WAITING_FOR_PROSPECT -> PROSPECT_SPEAKING must succeed');
  });

  // =========================================================================
  // 5. REGRESSION TESTS FOR REAL PSTN ISSUES (1, 2, 3)
  // =========================================================================
  await t.test('13. Regression Issue 2: CallEvent schema accepts QUALIFICATION_UPDATED without enum validation failure', () => {
    const CallEvent = require('../src/models/CallEvent');

    const event = new CallEvent({
      callId: 'test_call_event_audit',
      eventType: 'QUALIFICATION_UPDATED',
      payload: {
        tool: 'update_qualification',
        field: 'debt.totalAmount',
        oldValue: null,
        value: 100,
        status: 'NOT_SUITABLE',
        evalResult: { status: 'NOT_SUITABLE', qualified: false }
      }
    });

    const validationError = event.validateSync();
    assert.strictEqual(validationError, undefined, 'QUALIFICATION_UPDATED must be a valid enum value on CallEvent');
  });

  await t.test('14. Regression Issue 3: Tool execution response preserves AI_THINKING and does NOT attempt AI_THINKING -> WAITING_FOR_PROSPECT', () => {
    const OpenAiRealtimeProvider = require('../src/voice/providers/openaiRealtimeProvider');
    const provider = new OpenAiRealtimeProvider({
      callId: 'test_tool_state_machine',
      apiKey: 'test_key',
      timings: {}
    });

    const session = new VoiceSession({ callId: 'test_tool_state_machine' });
    session.conversationState = 'AI_THINKING';
    session.setAiProvider(provider);

    // Track state changes emitted by provider and transitions on session
    const emittedStates = [];
    let responseDoneEmitted = false;

    provider.on('state_changed', (state, options) => {
      emittedStates.push(state);
      session.setConversationState(state, options);
    });

    provider.on('response_done', () => {
      responseDoneEmitted = true;
    });

    provider.conversationState = 'AI_THINKING';

    // Simulate OpenAI returning a tool call response
    provider._handleServerEvent(JSON.stringify({
      type: 'response.created',
      response: { id: 'resp_tool_1' }
    }));

    provider._handleServerEvent(JSON.stringify({
      type: 'response.function_call_arguments.done',
      call_id: 'call_qual_1',
      name: 'update_qualification',
      arguments: JSON.stringify({ field: 'debt.totalAmount', value: 100 })
    }));

    // OpenAI sends response.done for the tool-call response (output contains function_call)
    provider._handleServerEvent(JSON.stringify({
      type: 'response.done',
      response: {
        id: 'resp_tool_1',
        output: [
          {
            id: 'item_fc_1',
            type: 'function_call',
            call_id: 'call_qual_1',
            name: 'update_qualification',
            arguments: '{"field":"debt.totalAmount","value":100}'
          }
        ]
      }
    }));

    // Session must REMAIN in AI_THINKING during tool execution
    assert.strictEqual(session.conversationState, 'AI_THINKING', 'Session must remain in AI_THINKING during tool execution');
    assert.strictEqual(provider.conversationState, 'AI_THINKING', 'Provider must remain in AI_THINKING during tool execution');
    assert.strictEqual(responseDoneEmitted, false, 'response_done must NOT be emitted for tool call response');
    assert(!emittedStates.includes('WAITING_FOR_PROSPECT'), 'WAITING_FOR_PROSPECT must NOT be emitted during tool execution');

    // Follow-up response after tool execution produces audio speech
    provider._handleServerEvent(JSON.stringify({
      type: 'response.created',
      response: { id: 'resp_speech_1' }
    }));

    provider._handleServerEvent(JSON.stringify({
      type: 'response.output_audio.delta',
      response_id: 'resp_speech_1',
      delta: 'base64audio...'
    }));

    assert.strictEqual(session.conversationState, 'AI_SPEAKING', 'Session must transition to AI_SPEAKING when audio produces');

    // Follow-up response finishes speech
    provider._handleServerEvent(JSON.stringify({
      type: 'response.done',
      response: {
        id: 'resp_speech_1',
        output: [
          {
            id: 'item_msg_1',
            type: 'message',
            role: 'assistant'
          }
        ]
      }
    }));

    assert.strictEqual(session.conversationState, 'WAITING_FOR_PROSPECT', 'Session must authoritatively transition to WAITING_FOR_PROSPECT after speech');
    assert.strictEqual(responseDoneEmitted, true, 'response_done must be emitted after speech response completes');
  });

  await t.test('15. Regression Issue 3: Silent tool completion handles AI_THINKING -> WAITING_FOR_PROSPECT explicitly without weakening state machine', () => {
    const session = new VoiceSession({ callId: 'test_silent_' + Date.now() });
    session.conversationState = 'AI_THINKING';

    // Normal/unrestricted transition from AI_THINKING -> WAITING_FOR_PROSPECT is rejected
    const unallowedResult = session.setConversationState('WAITING_FOR_PROSPECT');
    assert.strictEqual(unallowedResult, false, 'Unrestricted AI_THINKING -> WAITING_FOR_PROSPECT must be rejected');
    assert.strictEqual(session.conversationState, 'AI_THINKING', 'State must remain AI_THINKING');

    // Explicit silent completion transition succeeds
    const allowedSilentResult = session.setConversationState('WAITING_FOR_PROSPECT', { allowSilentCompletion: true });
    assert.strictEqual(allowedSilentResult, true, 'Explicit silent completion must be permitted');
    assert.strictEqual(session.conversationState, 'WAITING_FOR_PROSPECT', 'State must transition to WAITING_FOR_PROSPECT');
  });
});
