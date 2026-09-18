const mongoose = require('mongoose');

const callEventSchema = new mongoose.Schema({
  callId: { type: String, required: true, index: true },
  eventType: {
    type: String,
    enum: [
      'DIAL_INITIATED',
      'RINGING',
      'ANSWERED',
      'AMD_HUMAN_DETECTED',
      'AMD_MACHINE_DETECTED',
      'VOICEMAIL_DROP_PLAYED',
      'AI_AGENT_CONNECTED',
      'AI_TOOL_CALLED',
      'LEAD_QUALIFIED',
      'TRANSFER_REQUESTED',
      'TRANSFER_COMPLETED',
      'CALL_ENDED'
    ],
    required: true
  },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  timestamp: { type: Date, default: Date.now }
});

module.exports = mongoose.model('CallEvent', callEventSchema);
