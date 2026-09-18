const mongoose = require('mongoose');

const campaignLeadSchema = new mongoose.Schema({
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', required: true, index: true },
  status: {
    type: String,
    enum: ['pending', 'queued', 'calling', 'answered', 'voicemail', 'busy', 'no-answer', 'failed', 'dnc'],
    default: 'pending'
  },
  attempts: { type: Number, default: 0 },
  lastAttemptAt: { type: Date, default: null },
  createdAt: { type: Date, default: Date.now }
});

campaignLeadSchema.index({ campaignId: 1, leadId: 1 }, { unique: true });

module.exports = mongoose.model('CampaignLead', campaignLeadSchema);
