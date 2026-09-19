const mongoose = require('mongoose');

const agentPromptSchema = new mongoose.Schema({
  name: { type: String, required: true, default: 'UK IVA Senior Debt Advisor' },
  companyName: { type: String, required: true, default: 'Beacon Debt Advisory' },
  agentName: { type: String, required: true, default: 'Sarah Collins' },
  voice: { type: String, default: 'alloy' }, // OpenAI realtime voices: alloy, shimmer, echo, fable, onyx, nova
  language: { type: String, default: 'en-GB' },
  tone: {
    type: String,
    enum: ['professional', 'empathetic', 'friendly', 'direct', 'calm'],
    default: 'professional'
  },

  // Primary client-controlled instruction layer
  instructions: {
    type: String,
    default: ''
  },

  // Client greeting
  greeting: {
    type: String,
    default: ''
  },

  // Behaviour toggles
  behaviour: {
    askOneQuestionAtATime: { type: Boolean, default: true },
    allowInterruptions: { type: Boolean, default: true },
    offerCallback: { type: Boolean, default: true },
    transferOnRequest: { type: Boolean, default: true }
  },

  // Tenant / Client ownership
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', index: true },
  version: { type: Number, default: 1 },
  
  openingScript: {
    type: String,
    default: "Hi [LeadName], this is [AgentName] calling from [CompanyName] on a recorded line. I'm calling regarding recent UK government debt relief and IVA schemes for individuals managing unsecured personal debts over £5,000. Do you currently have debts such as credit cards, overdrafts, or loans that you're finding difficult to manage?"
  },

  debtQuestions: [
    {
      question: { type: String, default: "Approximately what is your total unsecured debt across all cards, loans, and overdrafts?" },
      field: { type: String, default: "debtAmount" },
      expectedType: { type: String, default: "number" }
    },
    {
      question: { type: String, default: "How many different creditors or lenders are you currently paying each month?" },
      field: { type: String, default: "creditorCount" },
      expectedType: { type: String, default: "number" }
    },
    {
      question: { type: String, default: "Are you a UK resident residing in England, Wales, or Northern Ireland?" },
      field: { type: String, default: "ukResident" },
      expectedType: { type: String, default: "boolean" }
    }
  ],

  qualificationRules: {
    minDebtAmount: { type: Number, default: 5000 },
    minCreditors: { type: Number, default: 2 },
    acceptedRegions: [{ type: String, default: 'England' }, { type: String, default: 'Wales' }, { type: String, default: 'Northern Ireland' }],
    employedOrRegularIncome: { type: Boolean, default: true }
  },

  transferRules: {
    autoTransferOnQualified: { type: Boolean, default: true },
    transferScript: {
      type: String,
      default: "That's brilliant news, [LeadName]. Based on having over £5,000 in debts across multiple creditors, you qualify for an IVA assessment that could write off up to 80% of your remaining debt and freeze interest. I'm going to connect you directly to our senior insolvency practitioner right now to finalize the details. Please hold the line for just a moment."
    },
    fallbackOnHoldFailure: {
      type: String,
      default: "It looks like all our senior debt practitioners are currently advising other clients. I have saved all your qualification notes and will have our team call you back within 15 minutes."
    }
  },

  voicemailMessage: {
    type: String,
    default: "Hello, this is [AgentName] from [CompanyName]. I was calling to share important updates regarding UK debt relief options and write-off programs. If you have over £5,000 in personal debt and would like to freeze interest and reduce monthly payments, please call us back on 0800 123 4567 or visit our website. Thank you."
  },

  systemPrompt: {
    type: String,
    default: `You are Sarah Collins, an empathetic, professional, and compliant UK IVA Debt Qualification Specialist representing Beacon Debt Advisory.
Your goal is to politely verify if the prospect qualifies for an Individual Voluntary Arrangement (IVA) in the UK.

RULES:
1. Speak in a natural British conversational tone. Be concise, polite, and respectful.
2. Ask one question at a time. Listen carefully.
3. If they have unsecured debt (credit cards, personal loans, overdrafts, catalogs) of £5,000 or more with 2 or more separate creditors, and live in England, Wales, or Northern Ireland, they are QUALIFIED.
4. If they are qualified:
   - Call the tool: mark_interested(level="high", debtAmount=calculatedDebt)
   - Read the warm transfer explanation politely.
   - Call the tool: transfer_call(reason="Qualified IVA prospect with £X debt")
5. If they are NOT interested or tell you to stop calling:
   - Apologize politely.
   - Call update_disposition(disposition="DNC", reason="Requested no calls")
   - Call end_call(reason="User not interested")
6. If they ask for a callback later:
   - Call schedule_callback(datetime="tomorrow", notes="Requested afternoon callback")
   - Call end_call(reason="Callback scheduled")
7. Always invoke save_notes() with key details before ending or transferring.`
  },

  isDefault: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('AgentPrompt', agentPromptSchema);
