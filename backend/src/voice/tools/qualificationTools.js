const Call = require('../../models/Call');
const Lead = require('../../models/Lead');
const CallEvent = require('../../models/CallEvent');
const AgentPrompt = require('../../models/AgentPrompt');
const { evaluateQualification } = require('../qualificationEngine');

async function handleMarkInterested({ level = 'medium', debtAmount }, session) {
  if (!session || !session.callId) {
    throw new Error('Valid session is required for mark_interested');
  }

  const numericDebt = debtAmount ? Number(debtAmount) : session.qualificationState.debtAmount;
  session.qualificationState.interested = true;
  if (!isNaN(numericDebt) && numericDebt > 0) {
    session.qualificationState.debtAmount = numericDebt;
  }

  // Load rules from AgentPrompt if available
  let rules = {};
  if (session.agentPromptId) {
    const promptDoc = await AgentPrompt.findById(session.agentPromptId);
    if (promptDoc?.qualificationRules) {
      rules = promptDoc.qualificationRules;
    }
  }

  const evalResult = evaluateQualification(session.qualificationState, rules);
  session.qualificationState.qualified = evalResult.qualified;

  // Persist to Call and Lead
  const callUpdate = { interested: true };
  if (evalResult.qualified) {
    callUpdate.disposition = 'Qualified';
  }
  await Call.findOneAndUpdate({ callId: session.callId }, callUpdate);

  if (session.leadId) {
    const leadUpdate = { interested: true };
    if (numericDebt) leadUpdate.debtAmount = numericDebt;
    if (evalResult.qualified) leadUpdate.disposition = 'Qualified';
    await Lead.findByIdAndUpdate(session.leadId, leadUpdate);
  }

  await CallEvent.create({
    callId: session.callId,
    eventType: evalResult.qualified ? 'LEAD_QUALIFIED' : 'AI_TOOL_CALLED',
    payload: { tool: 'mark_interested', level, debtAmount: numericDebt, evalResult }
  });

  console.log(`[VOICE] tool mark_interested executed for callId=${session.callId}, qualified=${evalResult.qualified}`);

  return {
    success: true,
    interested: true,
    qualified: evalResult.qualified,
    reasons: evalResult.reasons,
    missingFields: evalResult.missingFields
  };
}

module.exports = {
  handleMarkInterested
};
