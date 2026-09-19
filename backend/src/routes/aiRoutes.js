const express = require('express');
const router = express.Router();
const AgentPrompt = require('../models/AgentPrompt');
const axios = require('axios');
const { protect } = require('../controllers/authMiddleware');

// Apply authentication middleware
router.use(protect);

/**
 * Helper to check tenant/client ownership
 */
function isAuthorizedForAgent(agent, user) {
  if (!user || user.role === 'admin' || String(user._id) === 'dev_user_id') {
    return true;
  }
  if (!agent.userId && !agent.companyId) {
    return true; // Default/global legacy agent is accessible
  }
  if (agent.userId && String(agent.userId) === String(user._id)) {
    return true;
  }
  if (agent.companyId && user.companyId && String(agent.companyId) === String(user.companyId)) {
    return true;
  }
  return false;
}

/**
 * 1. GET /api/ai/agent - Get client agent configuration or default
 */
router.get('/agent', async (req, res) => {
  try {
    const userId = req.user?._id;
    const isRealUser = userId && String(userId) !== 'dev_user_id';

    let agent = null;

    if (isRealUser) {
      const query = { $or: [{ userId }] };
      if (req.user.companyId) {
        query.$or.push({ companyId: req.user.companyId });
      }
      agent = await AgentPrompt.findOne(query);
    }

    if (!agent) {
      agent = await AgentPrompt.findOne({ isDefault: true });
    }

    if (!agent) {
      agent = await AgentPrompt.create({
        isDefault: true,
        userId: isRealUser ? userId : undefined,
        companyId: req.user?.companyId
      });
    }

    res.json(agent);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 2. GET /api/ai/agent/:id - Get specific agent configuration by ID with ownership verification
 */
router.get('/agent/:id', async (req, res) => {
  try {
    const agent = await AgentPrompt.findById(req.params.id);
    if (!agent) {
      return res.status(404).json({ message: 'Agent configuration not found' });
    }

    if (!isAuthorizedForAgent(agent, req.user)) {
      return res.status(403).json({ message: 'Not authorized to access this agent configuration' });
    }

    res.json(agent);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 3. POST /api/ai/agent - Create new Agent persona linked to client
 */
router.post('/agent', async (req, res) => {
  try {
    const payload = sanitizeAgentPayload(req.body);
    const userId = req.user?._id;
    if (userId && String(userId) !== 'dev_user_id') {
      payload.userId = userId;
      payload.companyId = req.user?.companyId;
      payload.isDefault = false;
    }

    const agent = await AgentPrompt.create(payload);
    res.status(201).json(agent);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 4. PUT / PATCH /api/ai/agent/:id - Update Agent persona with explicit whitelist
 */
const updateAgentHandler = async (req, res) => {
  try {
    const agent = await AgentPrompt.findById(req.params.id);
    if (!agent) {
      return res.status(404).json({ message: 'Agent not found' });
    }

    if (!isAuthorizedForAgent(agent, req.user)) {
      return res.status(403).json({ message: 'Not authorized to modify this agent configuration' });
    }

    const updates = sanitizeAgentPayload(req.body);

    // Apply explicitly allowed fields
    for (const [key, val] of Object.entries(updates)) {
      if (key === 'behaviour') {
        agent.behaviour = { ...agent.behaviour?.toObject?.(), ...val };
      } else if (key === 'qualificationRules') {
        agent.qualificationRules = { ...agent.qualificationRules?.toObject?.(), ...val };
      } else if (key === 'transferRules') {
        agent.transferRules = { ...agent.transferRules?.toObject?.(), ...val };
      } else {
        agent[key] = val;
      }
    }

    // Keep greeting and openingScript synchronized for backward compatibility
    if (updates.greeting && !updates.openingScript) {
      agent.openingScript = updates.greeting;
    } else if (updates.openingScript && !updates.greeting) {
      agent.greeting = updates.openingScript;
    }

    // Increment configuration version for traceability
    agent.version = (agent.version || 1) + 1;
    agent.updatedAt = new Date();

    await agent.save();
    res.json(agent);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

router.put('/agent/:id', updateAgentHandler);
router.patch('/agent/:id', updateAgentHandler);

/**
 * Whitelist sanitizer to prevent arbitrary/malicious fields from polluting documents
 */
function sanitizeAgentPayload(body = {}) {
  const sanitized = {};

  if (typeof body.name === 'string') sanitized.name = body.name.trim();
  if (typeof body.companyName === 'string') sanitized.companyName = body.companyName.trim();
  if (typeof body.agentName === 'string') sanitized.agentName = body.agentName.trim();

  // Primary client instructions
  if (typeof body.instructions === 'string') sanitized.instructions = body.instructions;

  // Greeting / Opening script
  if (typeof body.greeting === 'string') sanitized.greeting = body.greeting;
  if (typeof body.openingScript === 'string') sanitized.openingScript = body.openingScript;

  // Tone & Voice
  if (typeof body.tone === 'string') {
    const allowedTones = ['professional', 'empathetic', 'friendly', 'direct', 'calm'];
    if (allowedTones.includes(body.tone.toLowerCase().trim())) {
      sanitized.tone = body.tone.toLowerCase().trim();
    }
  }
  if (typeof body.language === 'string') sanitized.language = body.language.trim();
  if (typeof body.voice === 'string') sanitized.voice = body.voice.trim();

  // Behaviour toggles
  if (body.behaviour && typeof body.behaviour === 'object') {
    sanitized.behaviour = {};
    if (typeof body.behaviour.askOneQuestionAtATime === 'boolean') {
      sanitized.behaviour.askOneQuestionAtATime = body.behaviour.askOneQuestionAtATime;
    }
    if (typeof body.behaviour.allowInterruptions === 'boolean') {
      sanitized.behaviour.allowInterruptions = body.behaviour.allowInterruptions;
    }
    if (typeof body.behaviour.offerCallback === 'boolean') {
      sanitized.behaviour.offerCallback = body.behaviour.offerCallback;
    }
    if (typeof body.behaviour.transferOnRequest === 'boolean') {
      sanitized.behaviour.transferOnRequest = body.behaviour.transferOnRequest;
    }
  }

  // Qualification Rules (business thresholds)
  if (body.qualificationRules && typeof body.qualificationRules === 'object') {
    sanitized.qualificationRules = {};
    if (typeof body.qualificationRules.minDebtAmount === 'number' && !isNaN(body.qualificationRules.minDebtAmount)) {
      sanitized.qualificationRules.minDebtAmount = Math.max(0, body.qualificationRules.minDebtAmount);
    }
    if (typeof body.qualificationRules.minCreditors === 'number' && !isNaN(body.qualificationRules.minCreditors)) {
      sanitized.qualificationRules.minCreditors = Math.max(0, Math.floor(body.qualificationRules.minCreditors));
    }
    if (Array.isArray(body.qualificationRules.acceptedRegions)) {
      sanitized.qualificationRules.acceptedRegions = body.qualificationRules.acceptedRegions
        .map(r => String(r).trim())
        .filter(Boolean);
    }
  }

  // Transfer rules
  if (body.transferRules && typeof body.transferRules === 'object') {
    sanitized.transferRules = {};
    if (typeof body.transferRules.transferScript === 'string') {
      sanitized.transferRules.transferScript = body.transferRules.transferScript;
    }
    if (typeof body.transferRules.autoTransferOnQualified === 'boolean') {
      sanitized.transferRules.autoTransferOnQualified = body.transferRules.autoTransferOnQualified;
    }
    if (typeof body.transferRules.fallbackOnHoldFailure === 'string') {
      sanitized.transferRules.fallbackOnHoldFailure = body.transferRules.fallbackOnHoldFailure;
    }
  }

  if (typeof body.voicemailMessage === 'string') sanitized.voicemailMessage = body.voicemailMessage;
  if (typeof body.systemPrompt === 'string') sanitized.systemPrompt = body.systemPrompt;

  return sanitized;
}

/**
 * 5. POST /api/ai/test - AI Sandbox Test
 */
router.post('/test', async (req, res) => {
  try {
    const { message, instructions, systemPrompt } = req.body;
    const promptToUse = instructions || systemPrompt || 'You are an empathetic UK IVA debt qualification specialist.';
    const apiKey = process.env.OPENAI_API_KEY;

    if (apiKey && apiKey.startsWith('sk-') && !apiKey.includes('your_openai')) {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: promptToUse },
            { role: 'user', content: message }
          ]
        },
        {
          headers: { Authorization: `Bearer ${apiKey}` }
        }
      );
      res.json({ reply: response.data.choices[0].message.content });
    } else {
      // Simulation response
      let reply = "Hello! I'm Sarah from Beacon Debt Advisory. Under the UK Government-backed Insolvency Act 1986, an IVA allows you to combine your unsecured debts into a single, affordable monthly payment, while freezing all interest and creditor action. How much unsecured debt do you have in total?";
      if (/card|debt|loan|5000|10000|thousand/i.test(message)) {
        reply = "Thank you for explaining that. With over £5,000 in unsecured debts across multiple lenders, you likely meet the primary threshold for an IVA. Would you like me to transfer you to our senior insolvency team to verify your creditor list?";
      }
      res.json({ reply, simulated: true });
    }
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
