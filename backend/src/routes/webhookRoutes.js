const express = require('express');
const router = express.Router();
const Call = require('../models/Call');
const CallEvent = require('../models/CallEvent');
const twilioService = require('../services/twilioService');
const { emitCallUpdate } = twilioService;

const Lead = require('../models/Lead');
const AgentPrompt = require('../models/AgentPrompt');
const sessionManager = require('../voice/sessionManager');
const { buildOpeningGreeting, escapeXml, mapOpenAiVoiceToPolly } = require('../voice/instructionBuilder');

/**
 * Twilio Webhook Handler (Status callbacks, SIP origination)
 */
router.post('/twilio', async (req, res) => {
  try {
    const { CallSid, CallStatus, From, To, CallDuration, AnsweredBy } = req.body;
    console.log(`[Twilio Webhook] CallSid: ${CallSid} Status: ${CallStatus} AnsweredBy: ${AnsweredBy}`);

    await CallEvent.create({
      callId: CallSid || 'twilio_call',
      eventType: 'TWILIO_STATUS_CALLBACK',
      payload: req.body
    });

    res.type('text/xml').send('<Response></Response>');
  } catch (err) {
    res.status(500).send(err.message);
  }
});

// Twilio requests this when the call is answered. The status callback supplies AnsweredBy.
router.post('/twilio/status', async (req, res) => {
  try {
    const { CallSid, CallStatus, AnsweredBy, CallDuration } = req.body;
    const call = await Call.findOne({ providerCallId: CallSid });
    if (call) {
      await CallEvent.create({
        callId: call.callId,
        eventType: 'TWILIO_STATUS_CALLBACK',
        payload: req.body
      });

      const statusMap = {
        initiated: 'initiated',
        ringing: 'ringing',
        'in-progress': 'in-call',
        completed: 'completed',
        busy: 'busy',
        'no-answer': 'no-answer',
        failed: 'failed',
        canceled: 'failed'
      };
      const mappedStatus = statusMap[CallStatus];
      if (mappedStatus && !['completed', 'busy', 'no-answer', 'failed'].includes(mappedStatus)) {
        const update = { status: mappedStatus };
        if (mappedStatus === 'in-call') {
          update.answeredAt = call.answeredAt || new Date();
          update.amdStatus = AnsweredBy === 'human' ? 'human' : call.amdStatus;
        }
        await Call.findOneAndUpdate({ _id: call._id }, update);
        emitCallUpdate({ callId: call.callId, ...update });
      }

      if (AnsweredBy && AnsweredBy !== 'human') {
        await twilioService.finalizeCall(call.callId, 'voicemail', `Twilio classified call as ${AnsweredBy}`);
      } else if (AnsweredBy === 'human') {
        // Human answered: AI voice agent converses with the caller. Transfer only happens when qualified.
        console.log(`[Twilio Webhook] Human answer verified for callId=${call.callId}. Voice Gateway active.`);
      } else if (CallStatus === 'completed' || CallStatus === 'busy' || CallStatus === 'no-answer' || CallStatus === 'failed') {
        const { finalizeAndCleanupSession } = require('../voice/voiceGateway');
        await finalizeAndCleanupSession(call.callId, `Twilio status: ${CallStatus}`);
        await twilioService.finalizeCall(call.callId, CallStatus, `Twilio call ended (${CallDuration || 0}s)`);
      }
    }
    res.sendStatus(204);
  } catch (err) {
    console.error(`[Twilio Webhook] Status handling failed: ${err.message}`);
    res.sendStatus(204);
  }
});



// Twilio requests TwiML on call connect. Speaks instant client-configured greeting then connects Media Stream.
router.post('/twilio/voice/:callId?', async (req, res) => {
  // Outbound calls include our call ID in the URL; inbound calls provide Twilio's CallSid.
  const callId = req.params.callId || req.body.CallSid || `inbound_${Date.now()}`;
  const baseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const streamUrl = baseUrl.replace(/^https:/i, 'wss:') + `/api/webhooks/twilio/media/${encodeURIComponent(callId)}`;

  // Asynchronously prewarm AI session (parallel DB lookups & OpenAI connection while Twilio speaks greeting)
  try {
    const { prewarmAiSession } = require('../voice/voiceGateway');
    prewarmAiSession(callId).catch((err) => {
      console.warn(`[VOICE] Prewarm notice for callId=${callId}: ${err.message}`);
    });
  } catch (err) {
    console.warn(`[VOICE] Prewarm invocation notice: ${err.message}`);
  }

  try {
    const [call, defaultPrompt] = await Promise.all([
      Call.findOne({ callId }).lean(),
      AgentPrompt.findOne({ isDefault: true }).lean()
    ]);

    let lead = null;
    let agentPrompt = defaultPrompt;

    if (call?.leadId) {
      lead = await Lead.findById(call.leadId).lean();
    }
    if (call?.agentPromptId) {
      const explicitPrompt = await AgentPrompt.findById(call.agentPromptId).lean();
      if (explicitPrompt) agentPrompt = explicitPrompt;
    } else if (call?.campaignId) {
      const Campaign = require('../models/Campaign');
      const campaign = await Campaign.findById(call.campaignId).populate('agentId').lean();
      if (campaign?.agentId) {
        agentPrompt = campaign.agentId;
      }
    }

    const openingGreeting = buildOpeningGreeting({
      agentConfig: agentPrompt || {},
      lead: lead || {}
    });
    const pollyVoice = mapOpenAiVoiceToPolly(agentPrompt?.voice);
    const escapedGreeting = escapeXml(openingGreeting);

    // Record greeting configuration on session
    const session = sessionManager.getOrCreateSession({ callId });
    session.openingScript = openingGreeting;
    session.greetingSpokenViaTwiml = false;
    session.pollyVoice = pollyVoice;

    // Connect bidirectional Media Stream immediately so AI can speak and listen simultaneously with true barge-in
    res.type('text/xml').send(
      `<Response><Connect><Stream url="${streamUrl}" /></Connect></Response>`
    );
  } catch (err) {
    console.error(`[Twilio Webhook] Error constructing TwiML: ${err.message}`);
    res.type('text/xml').send(
      `<Response><Connect><Stream url="${streamUrl}" /></Connect></Response>`
    );
  }
});

/**
 * Twilio Dial action webhook when a transferred call completes, is busy, or fails
 */
router.post('/twilio/transfer-status/:callId', async (req, res) => {
  try {
    const callId = req.params.callId;
    const { DialCallStatus, DialCallDuration, DialCallSid } = req.body;
    console.log(`[Twilio Transfer Webhook] callId=${callId}, DialCallStatus=${DialCallStatus}, duration=${DialCallDuration}`);

    const Transfer = require('../models/Transfer');
    const call = await Call.findOne({ callId });

    if (DialCallStatus === 'completed' || DialCallStatus === 'answered') {
      await CallEvent.create({
        callId,
        eventType: 'TRANSFER_COMPLETED',
        payload: { dialStatus: DialCallStatus, duration: DialCallDuration, dialCallSid: DialCallSid }
      }).catch(() => {});

      if (call) {
        await Call.findOneAndUpdate({ callId }, {
          status: 'completed',
          aiStatus: 'ended',
          disposition: 'Transferred to Specialist',
          endedAt: new Date()
        });
      }
      return res.type('text/xml').send('<Response><Hangup /></Response>');
    } else {
      // Specialist was busy, no-answer, or failed
      console.warn(`[Twilio Transfer Webhook] Transfer not completed for callId=${callId}: status=${DialCallStatus}`);

      await CallEvent.create({
        callId,
        eventType: 'TRANSFER_FAILED',
        payload: { dialStatus: DialCallStatus, dialCallSid: DialCallSid, provider: 'twilio' }
      }).catch(() => {});

      await Transfer.findOneAndUpdate(
        { callId },
        { status: DialCallStatus === 'busy' ? 'busy' : (DialCallStatus === 'no-answer' ? 'no-answer' : 'failed') }
      ).catch(() => {});

      if (call) {
        await Call.findOneAndUpdate({ callId }, {
          disposition: 'Transfer Failed - Specialist Unavailable',
          notes: call.notes ? `${call.notes} | Specialist ${DialCallStatus}` : `Specialist ${DialCallStatus}`
        });
      }

      // Return polite message to caller before hanging up
      return res.type('text/xml').send(
        '<Response><Say voice="Polly.Amy">We are sorry, but our specialist is currently on another consultation. A senior advisor will follow up with you shortly. Thank you.</Say><Hangup /></Response>'
      );
    }
  } catch (err) {
    console.error(`[Twilio Transfer Webhook] Error: ${err.message}`);
    res.type('text/xml').send('<Response><Hangup /></Response>');
  }
});

module.exports = router;
