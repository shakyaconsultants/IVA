const express = require('express');
const router = express.Router();
const Campaign = require('../models/Campaign');
const Lead = require('../models/Lead');
const { triggerCampaignDial } = require('../queues/queueManager');

/**
 * 1. GET /api/campaigns - List all campaigns
 */
router.get('/', async (req, res) => {
  try {
    const campaigns = await Campaign.find()
      .select('-callerId -transferNumber')
      .populate('agentId', 'agentName companyName')
      .sort({ createdAt: -1 });
    res.json(campaigns);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 2. POST /api/campaigns - Create campaign
 */
router.post('/', async (req, res) => {
  try {
    const {
      name,
      description,
      callingHoursStart,
      callingHoursEnd,
      maxCPS,
      concurrentCalls,
      agentId,
    } = req.body;

    const campaign = await Campaign.create({
      name,
      description,
      callingHoursStart: callingHoursStart || '09:00',
      callingHoursEnd: callingHoursEnd || '19:00',
      maxCPS: maxCPS || 2,
      concurrentCalls: concurrentCalls || 5,
      agentId,
      status: 'draft'
    });

    res.status(201).json(campaign);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 3. GET /api/campaigns/:id
 */
router.get('/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id).populate('agentId');
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
    
    const leadStats = await Lead.aggregate([
      { $match: { campaignId: campaign._id } },
      { $group: { _id: '$status', count: { $sum: 1 } } }
    ]);

    res.json({ campaign, leadStats });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 4. PUT /api/campaigns/:id
 */
router.put('/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });
    res.json(campaign);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Assign an ordered chunk of unassigned leads to this campaign.
router.post('/:id/assign-leads', async (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.body.limit, 10) || 50, 1), 10000);
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

    const leads = await Lead.find({ campaignId: { $exists: false }, status: 'new' })
      .sort({ createdAt: 1 })
      .limit(limit)
      .select('_id');

    if (leads.length > 0) {
      await Lead.updateMany(
        { _id: { $in: leads.map((lead) => lead._id) } },
        { $set: { campaignId: campaign._id } }
      );
      await Campaign.findByIdAndUpdate(campaign._id, { $inc: { totalLeads: leads.length } });
    }

    res.json({ message: `${leads.length} leads assigned to ${campaign.name}`, assigned: leads.length });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 5. POST /api/campaigns/:id/start
 */
router.post('/:id/start', async (req, res) => {
  try {
    const campaign = await Campaign.findByIdAndUpdate(
      req.params.id,
      { status: 'running', updatedAt: new Date() },
      { new: true }
    );

    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

    const leadCount = await Lead.countDocuments({
      campaignId: campaign._id,
      status: { $in: ['new', 'queued'] }
    });
    if (leadCount === 0) {
      await Campaign.findByIdAndUpdate(campaign._id, { status: 'paused' });
      return res.status(400).json({
        message: 'Campaign has no new leads assigned. Upload leads and select this campaign before starting.'
      });
    }

    // Trigger dialing queue
    await triggerCampaignDial(campaign._id);

    res.json({ message: `Campaign ${campaign.name} started successfully`, campaign });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 6. POST /api/campaigns/:id/pause
 */
router.post('/:id/pause', async (req, res) => {
  try {
    const campaign = await Campaign.findByIdAndUpdate(
      req.params.id,
      { status: 'paused', updatedAt: new Date() },
      { new: true }
    );

    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

    // Revert any un-dialed queued leads back to new
    await Lead.updateMany(
      { campaignId: campaign._id, status: 'queued' },
      { $set: { status: 'new' } }
    );

    res.json({ message: `Campaign ${campaign.name} paused`, campaign });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

/**
 * 7. POST /api/campaigns/:id/stop
 */
router.post('/:id/stop', async (req, res) => {
  try {
    const campaign = await Campaign.findByIdAndUpdate(
      req.params.id,
      { status: 'stopped', updatedAt: new Date() },
      { new: true }
    );

    if (!campaign) return res.status(404).json({ message: 'Campaign not found' });

    // Revert any un-dialed queued leads back to new
    await Lead.updateMany(
      { campaignId: campaign._id, status: 'queued' },
      { $set: { status: 'new' } }
    );

    res.json({ message: `Campaign ${campaign.name} stopped`, campaign });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
