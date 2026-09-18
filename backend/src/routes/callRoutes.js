const express = require('express');
const router = express.Router();
const Call = require('../models/Call');
const Lead = require('../models/Lead');
const twilioService = require('../services/twilioService');

/**
 * 1. GET /api/calls - Call History & Filter
 */
router.get('/', async (req, res) => {
  try {
    const {
      dateFrom,
      dateTo,
      campaignId,
      disposition,
      interested,
      transferred,
      status,
      page = 1,
      limit = 50
    } = req.query;

    const query = {};

    if (campaignId) query.campaignId = campaignId;
    if (status) query.status = status;
    if (disposition) query.disposition = disposition;
    if (interested !== undefined && interested !== '') query.interested = interested === 'true';
    if (transferred !== undefined && transferred !== '') query.transferred = transferred === 'true';

    if (dateFrom || dateTo) {
      query.createdAt = {};
      if (dateFrom) query.createdAt.$gte = new Date(dateFrom);
      if (dateTo) query.createdAt.$lte = new Date(dateTo);
    }

    const skip = (parseInt(page, 10) - 1) * parseInt(limit, 10);
    const [calls, total] = await Promise.all([
      Call.find(query)
        .populate('leadId', 'name phone debtAmount')
        .populate('campaignId', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit, 10)),
      Call.countDocuments(query)
    ]);

    res.json({
      calls,
      total,
      page: parseInt(page, 10),
      pages: Math.ceil(total / parseInt(limit, 10))
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 2. GET /api/calls/live - Active Live Calls for Live Calls Screen
 */
router.get('/live', async (req, res) => {
  try {
    const liveCalls = await Call.find({
      status: { $in: ['initiated', 'ringing', 'in-call', 'voicemail-detected', 'transferring'] }
    })
      .populate('leadId', 'name phone debtAmount postcode')
      .populate('campaignId', 'name')
      .sort({ startedAt: -1 });

    res.json(liveCalls);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 3. GET /api/calls/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const call = await Call.findOne({
      $or: [{ callId: req.params.id }, { _id: req.params.id.match(/^[0-9a-fA-F]{24}$/) ? req.params.id : null }]
    })
      .populate('leadId')
      .populate('campaignId');

    if (!call) return res.status(404).json({ message: 'Call not found' });
    res.json(call);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 4. POST /api/calls/start - Initiate manual test call
 */
router.post('/start', async (req, res) => {
  try {
    const { phone, name, campaignId } = req.body;

    if (!phone) {
      return res.status(400).json({ message: 'Phone number is required' });
    }

    // Find or create lead
    let lead = await Lead.findOne({ phone });
    if (!lead) {
      lead = await Lead.create({
        phone,
        name: name || 'Test Lead',
        campaignId,
        debtAmount: 7500,
        creditorCount: 3
      });
    }

    const result = await twilioService.originateCall({
      lead,
      campaign: campaignId ? { _id: campaignId } : null
    });

    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 5. POST /api/calls/:id/hangup
 */
router.post('/:id/hangup', async (req, res) => {
  try {
    const { reason = 'Agent Disconnected' } = req.body;
    const call = await twilioService.hangupCall(req.params.id, reason);
    res.json({ message: 'Call terminated', call });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 6. POST /api/calls/:id/transfer - Hotkey Transfer to Human Specialist
 */
router.post('/:id/transfer', async (req, res) => {
  try {
    const { destinationNumber, reason = 'Manual Hotkey Transfer' } = req.body;
    const result = await twilioService.transferCall(req.params.id, destinationNumber, reason);
    res.json(result);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
