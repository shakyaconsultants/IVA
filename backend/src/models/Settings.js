const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  key: { type: String, default: 'global_config', unique: true },
  
  // AMD (Answering Machine Detection) Tuning
  amd: {
    cutCallOnMachine: { type: Boolean, default: true },
    initialSilenceMs: { type: Number, default: 2500 },
    greetingMaxMs: { type: Number, default: 1500 },
    maxWords: { type: Number, default: 4 },
    afterGreetingSilenceMs: { type: Number, default: 800 }
  },

  // Calling & Transfers
  dialer: {
    maxConcurrentCalls: { type: Number, default: 5 },
    maxCPS: { type: Number, default: 2 },
    defaultCallingHoursStart: { type: String, default: '09:00' },
    defaultCallingHoursEnd: { type: String, default: '19:00' }
  },

  // Cost Rates (for Analytics & Billing)
  billing: {
    twilioPerMinCostGbp: { type: Number, default: 0.015 },
    openAiVoicePerMinCostGbp: { type: Number, default: 0.06 }
  },

  updatedAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Settings', settingsSchema);
