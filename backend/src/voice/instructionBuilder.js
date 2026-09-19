/**
 * UK IVA Cold Calling & Lead Qualification - Layered Instruction Builder
 * 
 * Implements a clean 3-tier instruction architecture:
 * 1. [PLATFORM RULES] - Mandatory backend operational, tool correctness, compliance, and lifecycle constraints.
 * 2. [CLIENT AGENT INSTRUCTIONS] - Client-controlled conversational behaviour, tone, objection handling, and guidelines.
 * 3. [CALL CONTEXT] - Dynamic session variables (prospect name, agent name, company name, phone).
 * 
 * Ensures the client defines HOW the agent talks, while the backend defines WHAT the system is allowed to do.
 */

const DEFAULT_CLIENT_INSTRUCTIONS = `You are a professional telephone voice assistant representing the company.
Follow the client's configured instructions.
Speak naturally, clearly, and conversationally.
Ask one question at a time when collecting information.
Do not invent facts.
Listen carefully to the customer and address their concerns politely.
Use available tools when appropriate.
Do not claim that a backend action was completed unless the tool confirms it.`;

/**
 * Builds the mandatory platform rules layer.
 * These rules protect tool correctness, deterministic qualification, call lifecycle, and regulatory safety.
 */
function buildPlatformRules() {
  return `1. CONVERSATION LIFECYCLE & TELEPHONY:
- You are participating in a live two-way telephone call over Twilio Media Streams.
- Keep all responses concise, spoken, and conversational (1 to 2 sentences per turn).
- Never deliver long monologues or recite bullet points.
- If the customer interrupts while you are speaking, stop speaking immediately and listen to the customer.

2. STRUCTURED QUALIFICATION & DATA COLLECTION:
- You collect customer facts. You DO NOT make legal or final qualification decisions.
- When the customer provides or clarifies financial facts (such as total unsecured debt, number of creditors, residency, employment, or housing), invoke the tool: update_qualification(field, value).
- The backend evaluates eligibility deterministically. Never tell the customer "You definitely qualify for an IVA" or "You are guaranteed approval".
- You are strictly forbidden from attempting to set qualification status or eligibility directly.

3. TOOL EXECUTION RULES:
- If the customer requests a warm transfer to a human specialist, or if transfer criteria are reached, invoke: transfer_call().
- If the customer asks to be called back later or is busy, politely confirm their preference and invoke: schedule_callback().
- If the customer is not interested, expresses hostility, or asks to be removed from the list, apologize politely, invoke update_disposition(disposition="Not Interested" or "DNC"), and invoke end_call().
- To preserve important customer details or context, invoke: save_notes().
- When the call concludes, speak a brief polite farewell and immediately invoke: end_call().
- Never fabricate tool execution; always rely on the backend tool response.

4. AUTHENTIC USER TURNS & INTENT VERIFICATION:
- Never conclude that a customer has declined, hung up, or requested DNC from an isolated word like "Bye", "Hello?", or ambient noise.
- If the customer's utterance is brief, ambiguous, or sounds like a greeting, politely re-introduce yourself or clarify: e.g. "Hello, this is Sarah calling about debt advisory, can you hear me okay?"
- NEVER invoke update_disposition(DNC) or end_call() unless the customer has explicitly stated in a full response that they are not interested, want no further calls, or clearly refuse to speak.
- Always require an explicit completed customer turn before ending a call.`;
}

/**
 * Formats client behaviour toggles and tone into conversational directives.
 */
function buildAgentSettings(agentConfig = {}) {
  const settings = [];

  // Tone
  const tone = agentConfig.tone || 'professional';
  settings.push(`- Conversation Tone: Maintain an empathetic, ${tone}, and respectful British English speaking style.`);

  // Behaviour flags
  const behaviour = agentConfig.behaviour || {};

  if (behaviour.askOneQuestionAtATime !== false) {
    settings.push('- Pacing: Ask exactly one question at a time. Always wait for the customer to respond before asking anything else.');
  }

  if (behaviour.allowInterruptions !== false) {
    settings.push('- Interruptibility: Be highly receptive to interruptions; adapt seamlessly if the customer changes direction.');
  }

  if (behaviour.offerCallback !== false) {
    settings.push('- Callback Option: If the customer mentions they are driving, working, or busy, promptly offer to arrange a callback.');
  }

  if (behaviour.transferOnRequest !== false) {
    settings.push('- Specialist Transfer: If the customer asks to speak with a human advisor or insolvency specialist, offer a live transfer.');
  }

  return settings.join('\n');
}

/**
 * Builds dynamic call context variables.
 */
function buildCallContext({ lead = {}, call = {}, agentConfig = {} }) {
  const leadName = lead.name || 'there';
  const agentName = agentConfig.agentName || 'Sarah Collins';
  const companyName = agentConfig.companyName || 'Beacon Debt Advisory';
  const leadPhone = lead.phone || call.leadPhone || 'Unknown';

  return `- Customer Name: ${leadName}
- AI Agent Name: ${agentName}
- Company Name: ${companyName}
- Customer Phone: ${leadPhone}`;
}

/**
 * Main Layered Instruction Assembler.
 * 
 * @param {Object} params
 * @param {Object} params.agentConfig - The client-controlled agent configuration document
 * @param {Object} [params.lead] - Lead information
 * @param {Object} [params.call] - Active call information
 * @returns {string} Final consolidated instructions sent to OpenAI Realtime session.update
 */
function buildRealtimeInstructions({ agentConfig = {}, lead = {}, call = {} }) {
  const leadName = lead.name || 'there';
  const agentName = agentConfig.agentName || 'Sarah Collins';
  const companyName = agentConfig.companyName || 'Beacon Debt Advisory';

  // 1. Client Instructions Layer
  let clientInstructions = (agentConfig.instructions || '').trim();

  // Backward-compatibility fallback: if instructions empty but systemPrompt exists
  if (!clientInstructions) {
    if (agentConfig.systemPrompt && typeof agentConfig.systemPrompt === 'string') {
      clientInstructions = agentConfig.systemPrompt.trim();
    } else {
      clientInstructions = DEFAULT_CLIENT_INSTRUCTIONS;
    }
  }

  // Replace placeholder tokens in client instructions
  clientInstructions = clientInstructions
    .replace(/\[LeadName\]/gi, leadName)
    .replace(/\[AgentName\]/gi, agentName)
    .replace(/\[CompanyName\]/gi, companyName);

  // 2. Platform Rules Layer
  const platformRules = buildPlatformRules();

  // 3. Settings & Behaviour Layer
  const agentSettings = buildAgentSettings(agentConfig);

  // 4. Call Context Layer
  const callContext = buildCallContext({ lead, call, agentConfig });

  // Layered composition
  return `[PLATFORM RULES]
${platformRules}

[CLIENT AGENT INSTRUCTIONS]
${clientInstructions}

[AGENT SETTINGS & BEHAVIOUR]
${agentSettings}

[CALL CONTEXT]
${callContext}
`.trim();
}

/**
 * Escapes XML special characters for safe TwiML rendering.
 * 
 * @param {string} text
 * @returns {string} XML-escaped text
 */
function escapeXml(text) {
  if (!text) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Maps OpenAI voice persona to an appropriate British English (en-GB) Twilio Polly voice.
 * 
 * @param {string} voice - Configured OpenAI voice name
 * @returns {string} Twilio Polly voice identifier
 */
function mapOpenAiVoiceToPolly(voice = '') {
  const normalized = (voice || '').toLowerCase().trim();
  const maleVoices = ['echo', 'onyx', 'fable'];
  const femaleVoices = ['alloy', 'shimmer', 'nova'];

  if (maleVoices.includes(normalized)) {
    return 'Polly.Arthur';
  }
  if (femaleVoices.includes(normalized)) {
    return 'Polly.Amy';
  }
  // Safe en-GB fallback
  return 'Polly.Amy';
}

/**
 * Builds the opening greeting spoken when the call connects.
 * 
 * Supports template placeholders:
 * - {{leadName}}, {{agentName}}, {{companyName}}
 * - [LeadName], [AgentName], [CompanyName]
 * - {leadName}, {agentName}, {companyName}
 * 
 * @param {Object} params
 * @param {Object} params.agentConfig
 * @param {Object} [params.lead]
 * @returns {string} Formatted opening greeting
 */
function buildOpeningGreeting({ agentConfig = {}, lead = {} }) {
  const leadName = (lead.name || 'there').trim();
  const agentName = (agentConfig.agentName || 'Sarah Collins').trim();
  const companyName = (agentConfig.companyName || 'Beacon Debt Advisory').trim();

  let greeting = (agentConfig.greeting && agentConfig.greeting.trim())
    || (agentConfig.openingScript && agentConfig.openingScript.trim())
    || `Hi ${leadName}, this is ${agentName} calling from ${companyName} on a recorded line. I'm calling regarding recent UK debt relief and IVA schemes for individuals managing unsecured personal debts over £5,000. Do you currently have debts such as credit cards, overdrafts, or loans that you're finding difficult to manage?`;

  return greeting
    .replace(/\{\{\s*leadName\s*\}\}/gi, leadName)
    .replace(/\{\{\s*agentName\s*\}\}/gi, agentName)
    .replace(/\{\{\s*companyName\s*\}\}/gi, companyName)
    .replace(/\[LeadName\]/gi, leadName)
    .replace(/\[AgentName\]/gi, agentName)
    .replace(/\[CompanyName\]/gi, companyName)
    .replace(/\{\s*leadName\s*\}/gi, leadName)
    .replace(/\{\s*agentName\s*\}/gi, agentName)
    .replace(/\{\s*companyName\s*\}/gi, companyName);
}

module.exports = {
  DEFAULT_CLIENT_INSTRUCTIONS,
  buildPlatformRules,
  buildAgentSettings,
  buildCallContext,
  buildRealtimeInstructions,
  buildOpeningGreeting,
  escapeXml,
  mapOpenAiVoiceToPolly
};
