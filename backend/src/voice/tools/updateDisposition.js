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
  const isNotInterested = matched.toLowerCase().includes('not interested');

  // Safety guard against false/noisy transcripts triggering DNC/Not Interested
  if (isDnc || isNotInterested) {
    const customerUtterances = (session.transcript || [])
      .filter((t) => t.speaker === 'customer')
      .map((t) => (t.text || '').toLowerCase().trim());

    const noiseWords = ['bye', 'bye.', 'thank you', 'thank you.', 'thanks', 'you', 'hello', 'hello?'];
    const hasSubstantiveTurn = customerUtterances.some((u) => !noiseWords.includes(u) && u.length > 3);

    if (!hasSubstantiveTurn && (session.durationSec || 0) < 15) {
      console.warn(`[VOICE TOOL] update_disposition(${matched}) rejected: no substantive customer turn in transcript for callId=${session.callId}`);
      return {
        success: false,
        blocked: true,
        message: `Cannot set ${matched} without an explicit customer statement. Please confirm if customer wishes to opt out.`
      };
    }
  }

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
