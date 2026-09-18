const mongoose = require('mongoose');

const dispositionSchema = new mongoose.Schema({
  code: { type: String, required: true, unique: true },
  label: { type: String, required: true },
  category: { type: String, enum: ['positive', 'negative', 'neutral', 'system'], default: 'neutral' },
  isInterested: { type: Boolean, default: false },
  isTransfer: { type: Boolean, default: false },
  isDnc: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Disposition', dispositionSchema);
