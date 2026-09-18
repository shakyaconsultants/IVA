const Call = require('../../models/Call');
const Lead = require('../../models/Lead');
const CallEvent = require('../../models/CallEvent');

async function handleScheduleCallback({ datetime, notes = '' }, session) {
  if (!session || !session.callId) {
    throw new Error('Valid session is required for schedule_callback');
  }

  if (!datetime) {
    return { success: false, message: 'Callback datetime is required' };
  }

  const callbackNote = `[Callback Scheduled for: ${datetime}] ${notes}`.trim();

  const call = await Call.findOne({ callId: session.callId });
  const updatedCallNotes = call?.notes ? `${call.notes} | ${callbackNote}` : callbackNote;

  await Call.findOneAndUpdate({ callId: session.callId }, {
    notes: updatedCallNotes,
    disposition: 'Callback Requested'
  });

  if (session.leadId) {
    const lead = await Lead.findById(session.leadId);
    const updatedLeadNotes = lead?.notes ? `${lead.notes} | ${callbackNote}` : callbackNote;
    await Lead.findByIdAndUpdate(session.leadId, {
      notes: updatedLeadNotes,
      disposition: 'Callback Requested'
    });
  }

  await CallEvent.create({
    callId: session.callId,
    eventType: 'AI_TOOL_CALLED',
    payload: { tool: 'schedule_callback', datetime, notes }
  });

  console.log(`[VOICE] tool schedule_callback executed for callId=${session.callId}: ${datetime}`);

  return {
    success: true,
    scheduled: true,
    datetime,
    notes
  };
}

module.exports = {
  handleScheduleCallback
};
