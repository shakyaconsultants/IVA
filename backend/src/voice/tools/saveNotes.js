const Call = require('../../models/Call');
const Lead = require('../../models/Lead');
const CallEvent = require('../../models/CallEvent');

async function handleSaveNotes({ notes }, session) {
  if (!session || !session.callId) {
    throw new Error('Valid session is required for save_notes');
  }

  if (!notes || typeof notes !== 'string') {
    return { success: false, message: 'Notes must be a non-empty string' };
  }

  const cleanNotes = notes.trim().slice(0, 1000); // Safety limit

  const call = await Call.findOne({ callId: session.callId });
  const updatedCallNotes = call?.notes ? `${call.notes} | ${cleanNotes}` : cleanNotes;

  await Call.findOneAndUpdate({ callId: session.callId }, { notes: updatedCallNotes });

  if (session.leadId) {
    const lead = await Lead.findById(session.leadId);
    const updatedLeadNotes = lead?.notes ? `${lead.notes} | ${cleanNotes}` : cleanNotes;
    await Lead.findByIdAndUpdate(session.leadId, { notes: updatedLeadNotes });
  }

  await CallEvent.create({
    callId: session.callId,
    eventType: 'AI_TOOL_CALLED',
    payload: { tool: 'save_notes', notes: cleanNotes }
  });

  console.log(`[VOICE] tool save_notes executed for callId=${session.callId}`);

  return {
    success: true,
    saved: true
  };
}

module.exports = {
  handleSaveNotes
};
