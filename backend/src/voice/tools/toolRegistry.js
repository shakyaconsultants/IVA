const { handleMarkInterested, handleUpdateQualification } = require('./qualificationTools');
const { handleTransferCall } = require('./transferCall');
const { handleSaveNotes } = require('./saveNotes');
const { handleUpdateDisposition } = require('./updateDisposition');
const { handleScheduleCallback } = require('./scheduleCallback');
const { handleEndCall } = require('./endCall');

/**
 * Provider-agnostic tool schemas formatted for OpenAI Realtime Voice API
 */
const TOOL_DEFINITIONS = [
  {
    type: 'function',
    name: 'mark_interested',
    description: 'Mark the UK IVA prospect as interested in debt relief and record total unsecured debt amount for qualification.',
    parameters: {
      type: 'object',
      properties: {
        level: {
          type: 'string',
          enum: ['low', 'medium', 'high'],
          description: 'Interest level of the prospect'
        },
        debtAmount: {
          type: 'number',
          description: 'Total unsecured debt amount in British Pounds (£) stated by the customer'
        }
      },
      required: ['debtAmount']
    }
  },
  {
    type: 'function',
    name: 'update_qualification',
    description: 'Update a specific customer qualification fact (e.g. debt total, creditor count, housing status, employment, or UK residency) extracted during conversation. The AI must never directly set qualification status.',
    parameters: {
      type: 'object',
      properties: {
        field: {
          type: 'string',
          description: 'Canonical field path or alias to update, e.g. "debt.totalAmount", "debt.creditorCount", "residency.ukResident", "residency.region", "income.employmentStatus"'
        },
        value: {
          description: 'The extracted value for this qualification fact (e.g. number, string, boolean, or array)'
        }
      },
      required: ['field', 'value']
    }
  },
  {
    type: 'function',
    name: 'transfer_call',
    description: 'Initiate a warm live transfer of the qualified prospect to a senior UK insolvency practitioner / human debt specialist.',
    parameters: {
      type: 'object',
      properties: {
        phone: {
          type: 'string',
          description: 'Transfer destination phone number in E.164 format (optional, defaults to company specialist number)'
        },
        reason: {
          type: 'string',
          description: 'Brief reason for transfer e.g. Qualified IVA prospect with £8,000 unsecured debt'
        }
      }
    }
  },
  {
    type: 'function',
    name: 'save_notes',
    description: 'Save key details, creditor numbers, employment info, or specific customer situation to the lead record.',
    parameters: {
      type: 'object',
      properties: {
        notes: {
          type: 'string',
          description: 'Concise factual notes from the conversation to preserve'
        }
      },
      required: ['notes']
    }
  },
  {
    type: 'function',
    name: 'update_disposition',
    description: 'Update the final disposition / outcome category of the call.',
    parameters: {
      type: 'object',
      properties: {
        disposition: {
          type: 'string',
          enum: ['Qualified', 'Interested', 'Not Interested', 'Callback Requested', 'Voicemail', 'Wrong Number', 'DNC'],
          description: 'Call disposition category'
        },
        reason: {
          type: 'string',
          description: 'Reason for this disposition update'
        }
      },
      required: ['disposition']
    }
  },
  {
    type: 'function',
    name: 'schedule_callback',
    description: 'Record a requested callback time if the customer cannot speak right now but is open to speaking later.',
    parameters: {
      type: 'object',
      properties: {
        datetime: {
          type: 'string',
          description: 'Preferred callback date and time requested by the customer'
        },
        notes: {
          type: 'string',
          description: 'Any additional notes regarding the callback'
        }
      },
      required: ['datetime']
    }
  },
  {
    type: 'function',
    name: 'end_call',
    description: 'Politely terminate the phone call when conversation has concluded or prospect requests not to continue.',
    parameters: {
      type: 'object',
      properties: {
        reason: {
          type: 'string',
          description: 'Reason for terminating the call'
        }
      }
    }
  }
];

/**
 * Executes a tool by name with parsed arguments
 */
async function executeTool(name, args = {}, session) {
  if (session?.conversationState === 'ENDED' || session?.isEnded) {
    console.log(`[VOICE] tool execution rejected for ${name} because session is ENDED`);
    return { success: false, error: 'Session already ended' };
  }

  if ((session?.conversationState === 'ENDING' || session?.isEnding) && !['save_notes', 'update_disposition', 'end_call'].includes(name)) {
    console.log(`[VOICE] tool execution rejected for ${name} because session is ENDING`);
    return { success: false, error: 'Session is currently ending' };
  }

  console.log(`[VOICE] tool call requested: name=${name}, callId=${session?.callId}`);

  try {
    switch (name) {
      case 'mark_interested':
        return await handleMarkInterested(args, session);
      case 'update_qualification':
        return await handleUpdateQualification(args, session);
      case 'transfer_call':
        return await handleTransferCall(args, session);
      case 'save_notes':
        return await handleSaveNotes(args, session);
      case 'update_disposition':
        return await handleUpdateDisposition(args, session);
      case 'schedule_callback':
        return await handleScheduleCallback(args, session);
      case 'end_call':
        return await handleEndCall(args, session);
      default:
        console.warn(`[VOICE] Unknown tool call requested: ${name}`);
        return { success: false, error: `Unknown tool name: ${name}` };
    }
  } catch (err) {
    console.error(`[VOICE] Error executing tool ${name}: ${err.message}`);
    return { success: false, error: err.message };
  }
}

module.exports = {
  TOOL_DEFINITIONS,
  executeTool
};
