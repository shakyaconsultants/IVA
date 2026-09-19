const mongoose = require('mongoose');
const Call = require('../../models/Call');
const Lead = require('../../models/Lead');
const CallEvent = require('../../models/CallEvent');
const AgentPrompt = require('../../models/AgentPrompt');
const { evaluateQualification } = require('../qualificationEngine');
const { normalizeAndValidateField } = require('../qualificationNormalization');
const { getNestedValue, setNestedValue } = require('../qualificationConstants');

/**
 * Updates a specific qualification fact extracted by the AI agent during conversation.
 * Normalizes input, deterministically runs the qualification engine, logs an audit entry,
 * and persists updated facts without allowing the AI to declare qualification status directly.
 * 
 * @param {Object} params
 * @param {string} params.field - Canonical dot path or alias (e.g. "debt.totalAmount", "creditorCount")
 * @param {any} params.value - The un-sanitized fact value from conversation
 * @param {Object} session - VoiceSession
 */
async function handleUpdateQualification({ field, value }, session) {
  if (!session || !session.callId) {
    throw new Error('Valid session is required for update_qualification');
  }

  // Security guard: AI must never directly declare qualification status or eligibility
  const lowerField = typeof field === 'string' ? field.toLowerCase().trim() : '';
  if (
    lowerField === 'qualified' ||
    lowerField === 'eligiblesofar' ||
    lowerField === 'status' ||
    lowerField === 'qualificationstatus' ||
    lowerField === 'checks'
  ) {
    return {
      success: false,
      error: 'Direct mutation of qualification status or eligibility by the AI is strictly prohibited. Qualification is evaluated deterministically by the backend rules engine.'
    };
  }

  // 1. Validate & Normalize
  const validation = normalizeAndValidateField(field, value);
  if (!validation.valid) {
    return {
      success: false,
      error: validation.error
    };
  }

  const { canonicalPath, value: normalizedValue } = validation;

  // 2. Capture audit trail (oldValue -> newValue)
  const oldValue = getNestedValue(session.qualificationState, canonicalPath) ?? null;

  // 3. Mutate session state
  setNestedValue(session.qualificationState, canonicalPath, normalizedValue);

  // Maintain backward-compatible top-level properties if canonical path maps to legacy alias
  if (canonicalPath === 'debt.totalAmount') session.qualificationState.debtAmount = normalizedValue;
  if (canonicalPath === 'debt.creditorCount') session.qualificationState.creditorCount = normalizedValue;
  if (canonicalPath === 'residency.ukResident') session.qualificationState.ukResident = normalizedValue;
  if (canonicalPath === 'residency.region') session.qualificationState.region = normalizedValue;

  // 4. Record audit entry
  const auditEntry = {
    field: canonicalPath,
    oldValue,
    newValue: normalizedValue,
    source: 'AI_CONVERSATION',
    timestamp: new Date()
  };
  if (!session.qualificationAudit) {
    session.qualificationAudit = [];
  }
  session.qualificationAudit.push(auditEntry);

  // 5. Load rules from agent configuration snapshot or AgentPrompt
  let rules = {};
  if (session.agentConfigSnapshot?.qualificationRules) {
    rules = session.agentConfigSnapshot.qualificationRules;
  } else if (session.agentPromptId) {
    try {
      const promptDoc = await AgentPrompt.findById(session.agentPromptId);
      if (promptDoc?.qualificationRules) {
        rules = promptDoc.qualificationRules;
      }
    } catch (err) {
      console.warn(`[VOICE] Failed to fetch AgentPrompt rules for session: ${err.message}`);
    }
  }

  // 6. Run deterministic qualification evaluation
  const evalResult = evaluateQualification(session.qualificationState, rules);
  session.qualificationState.qualified = evalResult.qualified;
  session.qualificationState.qualificationStatus = evalResult.status;
  session.qualificationState.missingFields = evalResult.missingFields;

  // 7. Persist to Call & Lead records (if DB connected)
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    try {
      const callUpdate = {
        qualification: session.qualificationState,
        qualificationStatus: evalResult.status
      };
      if (evalResult.qualified) {
        callUpdate.disposition = 'Qualified';
      }
      await Call.findOneAndUpdate({ callId: session.callId }, callUpdate);

      if (session.leadId) {
        const leadUpdate = {
          qualification: session.qualificationState,
          qualificationStatus: evalResult.status
        };
        const debtAmount = getNestedValue(session.qualificationState, 'debt.totalAmount');
        if (typeof debtAmount === 'number') leadUpdate.debtAmount = debtAmount;
        const creditorCount = getNestedValue(session.qualificationState, 'debt.creditorCount');
        if (typeof creditorCount === 'number') leadUpdate.creditorCount = creditorCount;
        if (evalResult.qualified) leadUpdate.disposition = 'Qualified';
        await Lead.findByIdAndUpdate(session.leadId, leadUpdate);
      }

      await CallEvent.create({
        callId: session.callId,
        eventType: evalResult.qualified ? 'LEAD_QUALIFIED' : 'QUALIFICATION_UPDATED',
        payload: {
          tool: 'update_qualification',
          field: canonicalPath,
          oldValue,
          value: normalizedValue,
          status: evalResult.status,
          evalResult
        }
      });
    } catch (dbErr) {
      console.warn(`[VOICE] Non-fatal DB persistence error in update_qualification: ${dbErr.message}`);
    }
  }

  console.log(`[VOICE] tool update_qualification executed: callId=${session.callId}, field=${canonicalPath}, value=${normalizedValue}, status=${evalResult.status}, qualified=${evalResult.qualified}`);

  return {
    success: true,
    updatedField: canonicalPath,
    value: normalizedValue,
    qualification: {
      status: evalResult.status,
      qualified: evalResult.qualified,
      missingFields: evalResult.missingFields,
      checks: evalResult.checks,
      reasons: evalResult.reasons
    }
  };
}

/**
 * Legacy mark_interested handler preserved for full backward compatibility
 */
async function handleMarkInterested({ level = 'medium', debtAmount }, session) {
  if (!session || !session.callId) {
    throw new Error('Valid session is required for mark_interested');
  }

  const numericDebt = debtAmount ? Number(debtAmount) : session.qualificationState.debtAmount;
  session.qualificationState.interested = true;
  if (!isNaN(numericDebt) && numericDebt > 0) {
    session.qualificationState.debtAmount = numericDebt;
    setNestedValue(session.qualificationState, 'debt.totalAmount', numericDebt);
  }

  // Load rules from AgentPrompt if available
  let rules = {};
  if (session.agentConfigSnapshot?.qualificationRules) {
    rules = session.agentConfigSnapshot.qualificationRules;
  } else if (session.agentPromptId) {
    try {
      const promptDoc = await AgentPrompt.findById(session.agentPromptId);
      if (promptDoc?.qualificationRules) {
        rules = promptDoc.qualificationRules;
      }
    } catch (err) {
      console.warn(`[VOICE] Failed to fetch AgentPrompt rules: ${err.message}`);
    }
  }

  const evalResult = evaluateQualification(session.qualificationState, rules);
  session.qualificationState.qualified = evalResult.qualified;
  session.qualificationState.qualificationStatus = evalResult.status;

  // Persist to Call and Lead (if DB connected)
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    try {
      const callUpdate = {
        interested: true,
        qualification: session.qualificationState,
        qualificationStatus: evalResult.status
      };
      if (evalResult.qualified) {
        callUpdate.disposition = 'Qualified';
      }
      await Call.findOneAndUpdate({ callId: session.callId }, callUpdate);

      if (session.leadId) {
        const leadUpdate = {
          interested: true,
          qualification: session.qualificationState,
          qualificationStatus: evalResult.status
        };
        if (numericDebt) leadUpdate.debtAmount = numericDebt;
        if (evalResult.qualified) leadUpdate.disposition = 'Qualified';
        await Lead.findByIdAndUpdate(session.leadId, leadUpdate);
      }

      await CallEvent.create({
        callId: session.callId,
        eventType: evalResult.qualified ? 'LEAD_QUALIFIED' : 'AI_TOOL_CALLED',
        payload: { tool: 'mark_interested', level, debtAmount: numericDebt, evalResult }
      });
    } catch (dbErr) {
      console.warn(`[VOICE] Non-fatal DB persistence error in mark_interested: ${dbErr.message}`);
    }
  }

  console.log(`[VOICE] tool mark_interested executed for callId=${session.callId}, qualified=${evalResult.qualified}`);

  return {
    success: true,
    interested: true,
    qualified: evalResult.qualified,
    status: evalResult.status,
    reasons: evalResult.reasons,
    missingFields: evalResult.missingFields
  };
}

module.exports = {
  handleUpdateQualification,
  handleMarkInterested
};
