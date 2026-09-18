const Call = require('../../models/Call');
const Lead = require('../../models/Lead');
const CallEvent = require('../../models/CallEvent');

// Standard allowed dispositions
const ALLOWED_DISPOSITIONS = [
  'Qualified',
  'Interested',
  'Not Interested',
  'Callback Requested',
  'Voicemail',
  'Wrong Number',
  'DNC',
  'Completed',
  'Transferred to Specialist'
];

async function handleUpdateDisposition({ disposition, reason = '' }, session) {
  if (!session || !session.callId) {
    throw new Error('Valid session is required for update_disposition');
  }

  if (!disposition || typeof disposition !== 'string') {
    return { success: false, message: 'Valid disposition is required' };
  }

  // Normalize match against allowed list if possible
  const matched = ALLOWED_DISPOSITIONS.find(
    (d) => d.toLowerCase() === disposition.trim().toLowerCase()
  ) || disposition.trim();

  const isDnc = matched.toLowerCase().includes('dnc') || matched.toLowerCase().includes('do not call');

  const callUpdate = { disposition: matched };
  if (isDnc) callUpdate.interested = false;
  await Call.findOneAndUpdate({ callId: session.callId }, callUpdate);

  if (session.leadId) {
    const leadUpdate = { disposition: matched };
    if (isDnc) {
      leadUpdate.status = 'dnc';
      leadUpdate.interested = false;
    }
    await Lead.findByIdAndUpdate(session.leadId, leadUpdate);
  }

  await CallEvent.create({
    callId: session.callId,
    eventType: 'AI_TOOL_CALLED',
    payload: { tool: 'update_disposition', disposition: matched, reason, isDnc }
  });

  console.log(`[VOICE] tool update_disposition executed for callId=${session.callId}: ${matched}`);

  return {
    success: true,
    disposition: matched,
    isDnc
  };
}

module.exports = {
  handleUpdateDisposition,
  ALLOWED_DISPOSITIONS
};
