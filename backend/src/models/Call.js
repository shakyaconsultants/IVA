const mongoose = require('mongoose');

const callSchema = new mongoose.Schema({
  callId: { type: String, required: true, unique: true, index: true },
  providerCallId: { type: String, default: '' },
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', index: true },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', index: true },
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
    enum: ['idle', 'greeting', 'asking-debt', 'qualifying', 'handling-objection', 'transferring', 'ended'],
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
  interested: { type: Boolean, default: false },
  transferred: { type: Boolean, default: false },
  transferDestination: { type: String, default: '' },
  cost: { type: Number, default: 0.0 }, // in GBP (£)
  recordingUrl: { type: String, default: '' },
  transcript: [
    {
      speaker: { type: String, enum: ['ai', 'user', 'system'] },
      text: { type: String },
      timestamp: { type: Date, default: Date.now }
    }
  ],
  notes: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Call', callSchema);
