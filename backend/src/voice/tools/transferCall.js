const twilioService = require('../../services/twilioService');
const Call = require('../../models/Call');
const Transfer = require('../../models/Transfer');
const CallEvent = require('../../models/CallEvent');

async function handleTransferCall({ phone, reason = 'Qualified IVA prospect' }, session) {
  if (!session || !session.callId) {
    throw new Error('Valid session is required for transfer_call');
  }

  const call = await Call.findOne({ callId: session.callId });
  if (!call || !['initiated', 'ringing', 'in-call', 'human-detected'].includes(call.status)) {
    throw new Error(`Cannot transfer call with status: ${call?.status}`);
  }

  const targetNumber = phone || call.transferDestination || process.env.DEFAULT_TRANSFER_NUMBER;
  if (!targetNumber) {
    throw new Error('No transfer destination phone number provided');
  }

  console.log(`[VOICE] transfer requested for callId=${session.callId} to target=${targetNumber}`);

  // Execute Twilio transfer
  const result = await twilioService.transferCall(session.callId, targetNumber, reason);

  // Save Transfer record
  await Transfer.create({
    callId: session.callId,
    leadId: session.leadId,
    fromCallerId: call.callerId,
    transferDestination: targetNumber,
    status: 'connected',
    reason,
    durationSec: session.durationSec || 0
  });

  session.setAiStatus('transferring');

  return {
    success: true,
    transferred: true,
    destination: targetNumber,
    reason
  };
}

module.exports = {
  handleTransferCall
};
