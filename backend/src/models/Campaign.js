const mongoose = require('mongoose');

const campaignSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  description: { type: String, default: '' },
  callingHoursStart: { type: String, default: '09:00' }, // UK Local Time (HH:mm)
  callingHoursEnd: { type: String, default: '19:00' },   // UK Local Time (HH:mm)
  maxCPS: { type: Number, default: 2 },                  // Calls per second
  concurrentCalls: { type: Number, default: 5 },         // Max simultaneous calls
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentPrompt' },
  status: {
    type: String,
    enum: ['draft', 'running', 'paused', 'stopped', 'completed'],
    default: 'draft',
    index: true
  },
  totalLeads: { type: Number, default: 0 },
  dialedLeads: { type: Number, default: 0 },
  answeredCalls: { type: Number, default: 0 },
  voicemailCalls: { type: Number, default: 0 },
  interestedLeads: { type: Number, default: 0 },
  transferredCalls: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Campaign', campaignSchema);
