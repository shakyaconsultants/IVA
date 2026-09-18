const express = require('express');
const router = express.Router();
const Call = require('../models/Call');
const Lead = require('../models/Lead');
const Campaign = require('../models/Campaign');

router.get('/', async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalLeads,
      callsToday,
      totalDialed,
      answeredCalls,
      voicemailCalls,
      humanCalls,
      interestedCount,
      transferredCount,
      totalCostAgg,
      totalDurationAgg
    ] = await Promise.all([
      Lead.countDocuments(),
      Call.countDocuments({ createdAt: { $gte: today } }),
      Call.countDocuments(),
      Call.countDocuments({ status: { $in: ['in-call', 'completed', 'transferred', 'voicemail-detected'] } }),
      Call.countDocuments({ amdStatus: 'machine' }),
      Call.countDocuments({ amdStatus: 'human' }),
      Lead.countDocuments({ interested: true }),
      Call.countDocuments({ transferred: true }),
      Call.aggregate([{ $group: { _id: null, totalCost: { $sum: '$cost' } } }]),
      Call.aggregate([{ $group: { _id: null, totalSeconds: { $sum: '$durationSec' } } }])
    ]);

    const totalCost = totalCostAgg[0]?.totalCost || 0;
    const totalSeconds = totalDurationAgg[0]?.totalSeconds || 0;
    const minutesUsed = Math.round((totalSeconds / 60) * 10) / 10;

    const answerRate = totalDialed > 0 ? Math.round((answeredCalls / totalDialed) * 100) : 0;
    const humanPct = answeredCalls > 0 ? Math.round((humanCalls / answeredCalls) * 100) : 0;
    const voicemailPct = answeredCalls > 0 ? Math.round((voicemailCalls / answeredCalls) * 100) : 0;
    const interestedPct = totalDialed > 0 ? Math.round((interestedCount / totalDialed) * 100) : 0;
    const conversionPct = totalDialed > 0 ? Math.round((transferredCount / totalDialed) * 100) : 0;

    const costPerLead = totalLeads > 0 ? Math.round((totalCost / totalLeads) * 100) / 100 : 0;
    const costPerTransfer = transferredCount > 0 ? Math.round((totalCost / transferredCount) * 100) / 100 : 0;

    // Hourly call distribution for chart
    const hourlyCalls = await Call.aggregate([
      { $match: { createdAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } },
      {
        $group: {
          _id: { $hour: '$createdAt' },
          count: { $sum: 1 },
          transferred: { $sum: { $cond: ['$transferred', 1, 0] } }
        }
      },
      { $sort: { '_id': 1 } }
    ]);

    // Disposition breakdown
    const dispositionBreakdown = await Call.aggregate([
      { $group: { _id: '$disposition', count: { $sum: 1 } } },
      { $sort: { count: -1 } }
    ]);

    res.json({
      overview: {
        totalLeads,
        callsToday,
        totalDialed,
        answeredCalls,
        voicemailCalls,
        humanCalls,
        interestedCount,
        transferredCount,
        minutesUsed,
        totalCost: Math.round(totalCost * 100) / 100,
        answerRate,
        humanPct,
        voicemailPct,
        interestedPct,
        conversionPct,
        costPerLead,
        costPerTransfer
      },
      hourlyCalls,
      dispositionBreakdown
    });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
