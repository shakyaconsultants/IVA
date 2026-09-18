const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  phone: { type: String, required: true, index: true },
  name: { type: String, required: true, trim: true },
  email: { type: String, trim: true, default: '' },
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', index: true },
  status: {
    type: String,
    enum: ['new', 'queued', 'dialing', 'ringing', 'in-call', 'transferred', 'voicemail', 'completed', 'failed', 'dnc'],
    default: 'new',
    index: true
  },
  attempts: { type: Number, default: 0 },
  lastCallAt: { type: Date, default: null },
  disposition: { type: String, default: 'Pending' },
  interested: { type: Boolean, default: false },
  transferred: { type: Boolean, default: false },
  debtAmount: { type: Number, default: 0 },
  creditorCount: { type: Number, default: 0 },
  postcode: { type: String, default: '' },
  notes: { type: String, default: '' },
  lastCallId: { type: mongoose.Schema.Types.ObjectId, ref: 'Call' },
  createdAt: { type: Date, default: Date.now }
});

leadSchema.index({ phone: 1, campaignId: 1 }, { unique: true });

module.exports = mongoose.model('Lead', leadSchema);
