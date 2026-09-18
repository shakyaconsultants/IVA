const express = require('express');
const router = express.Router();
const AgentPrompt = require('../models/AgentPrompt');
const axios = require('axios');
const Settings = require('../models/Settings');

/**
 * 1. GET /api/ai/agent/:id or default
 */
router.get('/agent', async (req, res) => {
  try {
    let agent = await AgentPrompt.findOne({ isDefault: true });
    if (!agent) {
      agent = await AgentPrompt.create({ isDefault: true });
    }
    res.json(agent);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

router.get('/agent/:id', async (req, res) => {
  try {
    const agent = await AgentPrompt.findById(req.params.id);
    if (!agent) return res.status(404).json({ message: 'Agent configuration not found' });
    res.json(agent);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 2. POST /api/ai/agent - Create new Agent persona
 */
router.post('/agent', async (req, res) => {
  try {
    const agent = await AgentPrompt.create(req.body);
    res.status(201).json(agent);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 3. PUT /api/ai/agent/:id - Update Agent persona
 */
router.put('/agent/:id', async (req, res) => {
  try {
    const agent = await AgentPrompt.findByIdAndUpdate(
      req.params.id,
      { ...req.body, updatedAt: new Date() },
      { new: true }
    );
    if (!agent) return res.status(404).json({ message: 'Agent not found' });
    res.json(agent);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 4. POST /api/ai/test - AI Sandbox Test
 */
router.post('/test', async (req, res) => {
  try {
    const { message, systemPrompt, debtQuestions } = req.body;
    const apiKey = process.env.OPENAI_API_KEY;

    if (apiKey && apiKey.startsWith('sk-') && !apiKey.includes('your_openai')) {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model: 'gpt-4o-mini',
          messages: [
            { role: 'system', content: systemPrompt || 'You are an empathetic UK IVA debt qualification specialist.' },
            { role: 'user', content: message }
          ]
        },
        {
          headers: { Authorization: `Bearer ${apiKey}` }
        }
      );
      res.json({ reply: response.data.choices[0].message.content });
    } else {
      // Realistic simulation response for Option B
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
