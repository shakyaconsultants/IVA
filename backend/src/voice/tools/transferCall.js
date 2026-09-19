const twilioService = require('../../services/twilioService');
const Call = require('../../models/Call');
const Transfer = require('../../models/Transfer');
const CallEvent = require('../../models/CallEvent');

async function handleTransferCall({ phone, reason = 'Qualified IVA prospect' } = {}, session) {
  if (!session || !session.callId) {
    throw new Error('Valid session is required for transfer_call');
  }

  // 1. Duplicate transfer prevention
  if (session.isTransferring || session.isTransferred || session.isEnding || session.isEnded) {
    console.log(`[VOICE] duplicate transfer_call ignored for callId=${session.callId}`);
    return {
      success: true,
      transferred: true,
      destination: session.transferDestination || phone,
      message: 'Transfer already in progress or completed'
    };
  }

  const call = await Call.findOne({ callId: session.callId });
  if (!call || !['initiated', 'ringing', 'in-call', 'human-detected', 'transferring'].includes(call.status)) {
    throw new Error(`Cannot transfer call with status: ${call?.status}`);
  }

  if (call.transferred || call.status === 'transferring') {
    console.log(`[VOICE] call already transferred in database for callId=${session.callId}`);
    return {
      success: true,
      transferred: true,
      destination: call.transferDestination || phone,
      message: 'Call already transferred'
    };
  }

  // 2. Resolve destination phone number
  let targetNumber = phone || call.transferDestination || process.env.DEFAULT_TRANSFER_NUMBER;
  // If phone matches dummy prompt placeholder (+442080009999), substitute with configured DEFAULT_TRANSFER_NUMBER
  if ((targetNumber === '+442080009999' || targetNumber === '442080009999') && process.env.DEFAULT_TRANSFER_NUMBER) {
    console.log(`[VOICE] substituting placeholder destination ${targetNumber} with configured DEFAULT_TRANSFER_NUMBER=${process.env.DEFAULT_TRANSFER_NUMBER}`);
    targetNumber = process.env.DEFAULT_TRANSFER_NUMBER;
  }

  // Normalize targetNumber (strip spaces, dashes, parentheses)
  const cleanTarget = targetNumber ? String(targetNumber).replace(/[\s()-]/g, '') : '';
  const isValidPhone = cleanTarget && /^\+?[1-9]\d{6,14}$/.test(cleanTarget);

  if (!isValidPhone) {
    console.error(`[VOICE] Invalid transfer destination phone number: "${targetNumber}" for callId=${session.callId}`);
    await CallEvent.create({
      callId: session.callId,
      eventType: 'TRANSFER_FAILED',
      payload: { error: 'Invalid destination phone number', target: targetNumber, provider: 'twilio' }
    }).catch(() => {});

    return {
      success: false,
      transferred: false,
      error: `Invalid transfer destination phone number: ${targetNumber || 'none'}`
    };
  }

  targetNumber = cleanTarget;
  session.transferDestination = targetNumber;

  // 3. Mark session flags to stop AI speaking and prevent further turns
  session.isTransferring = true;
  session.isTransferred = true;
  session.isEnding = true;
  session.setConversationState('ENDING');
  if (session.aiProvider && typeof session.aiProvider.setEnding === 'function') {
    session.aiProvider.setEnding(true);
  }
  if (session.aiProvider && typeof session.aiProvider.clearAudio === 'function') {
    session.aiProvider.clearAudio();
  }
  session.setAiStatus('transferring');

  console.log(`[VOICE] transfer requested for callId=${session.callId} to target=${targetNumber}`);

  // 4. Execute Twilio transfer
  let transferResult;
  try {
    transferResult = await twilioService.transferCall(session.callId, targetNumber, reason);
  } catch (err) {
    console.error(`[VOICE] Twilio transfer failed for callId=${session.callId}: ${err.message}`);
    session.isTransferring = false;
    session.isTransferred = false;
    session.isEnding = false;
    if (session.aiProvider && typeof session.aiProvider.setEnding === 'function') {
      session.aiProvider.setEnding(false);
    }

    await CallEvent.create({
      callId: session.callId,
      eventType: 'TRANSFER_FAILED',
      payload: { error: err.message, target: targetNumber, provider: 'twilio' }
    }).catch(() => {});

    await Transfer.create({
      callId: session.callId,
      leadId: session.leadId,
      fromCallerId: call.callerId,
      transferDestination: targetNumber,
      status: 'failed',
      reason: `Twilio transfer error: ${err.message}`,
      durationSec: session.durationSec || 0
    }).catch(() => {});

    return {
      success: false,
      transferred: false,
      error: `Transfer execution failed: ${err.message}`
    };
  }

  // 5. Save Transfer record
  await Transfer.create({
    callId: session.callId,
    leadId: session.leadId,
    fromCallerId: call.callerId,
    transferDestination: targetNumber,
    status: 'connected',
    reason,
    durationSec: session.durationSec || 0
  }).catch(() => {});

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
