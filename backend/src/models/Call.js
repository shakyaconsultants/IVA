const mongoose = require('mongoose');

const callSchema = new mongoose.Schema({
  callId: { type: String, required: true, unique: true, index: true },
  providerCallId: { type: String, default: '' },
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', index: true },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', index: true },
  agentPromptId: { type: mongoose.Schema.Types.ObjectId, ref: 'AgentPrompt', index: true },
  agentConfigVersion: { type: Number, default: 1 },
  leadPhone: { type: String, required: true },
  callerId: { type: String, required: true },
  status: {
    type: String,
    enum: ['initiated', 'ringing', 'in-call', 'human-detected', 'voicemail-detected', 'voicemail', 'transferring', 'transferred', 'completed', 'busy', 'no-answer', 'failed'],
    default: 'initiated',
    index: true
  },
  aiStatus: {
    type: String,
    enum: [
      'idle',
      'connecting',
      'connected',
      'listening',
      'thinking',
      'speaking',
      'interrupted',
      'transferring',
      'ending',
      'ended',
      'error',
      'greeting',
      'asking-debt',
      'qualifying',
      'handling-objection'
    ],
    default: 'idle'
  },
  amdStatus: {
    type: String,
    enum: ['pending', 'human', 'machine', 'notsure'],
    default: 'pending'
  },
  durationSec: { type: Number, default: 0 },
  startedAt: { type: Date, default: Date.now },
  answeredAt: { type: Date },
  endedAt: { type: Date },
  disposition: { type: String, default: 'In Progress' },
  qualificationStatus: {
    type: String,
    enum: [
      'IN_PROGRESS',
      'INFORMATION_COMPLETE',
      'POTENTIAL_REFERRAL',
      'NEEDS_REVIEW',
      'NOT_SUITABLE',
      'CUSTOMER_DECLINED',
      'CALLBACK_REQUIRED',
      'TRANSFER_READY'
    ],
    default: 'IN_PROGRESS'
  },
  qualification: { type: mongoose.Schema.Types.Mixed, default: null },
  interested: { type: Boolean, default: false },
  transferred: { type: Boolean, default: false },
  transferDestination: { type: String, default: '' },
  cost: { type: Number, default: 0.0 }, // in GBP (£)
  recordingUrl: { type: String, default: '' },
  transcript: [
    {
      speaker: { type: String, enum: ['ai', 'user', 'system', 'customer', 'assistant'] },
      text: { type: String },
      timestamp: { type: Date, default: Date.now }
    }
  ],
  notes: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Call', callSchema);
