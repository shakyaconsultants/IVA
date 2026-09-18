const mongoose = require('mongoose');

const transferSchema = new mongoose.Schema({
  callId: { type: String, required: true, index: true },
  leadId: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead', index: true },
  fromCallerId: { type: String, required: true },
  transferDestination: { type: String, required: true },
  status: {
    type: String,
    enum: ['initiated', 'ringing', 'connected', 'busy', 'no-answer', 'failed'],
    default: 'initiated'
  },
  reason: { type: String, default: 'Qualified IVA prospect' },
  durationSec: { type: Number, default: 0 },
  agentNotes: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Transfer', transferSchema);
