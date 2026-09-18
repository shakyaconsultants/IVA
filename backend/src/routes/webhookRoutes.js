const express = require('express');
const router = express.Router();
const Call = require('../models/Call');
const CallEvent = require('../models/CallEvent');
const twilioService = require('../services/twilioService');
const { emitCallUpdate } = twilioService;

const escapeXml = (value) => String(value).replace(/[<>&'\"]/g, (character) => ({
  '<': '&lt;',
  '>': '&gt;',
  '&': '&amp;',
  "'": '&apos;',
  '"': '&quot;'
}[character]));

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

// Twilio requests TwiML on call connect. Connects bidirectional audio Media Stream to Voice Gateway.
router.post('/twilio/voice/:callId', (req, res) => {
  const callId = req.params.callId;
  const baseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const streamUrl = baseUrl.replace(/^https:/i, 'wss:') + `/api/webhooks/twilio/media/${encodeURIComponent(callId)}`;

  // Asynchronously prewarm AI session (parallel DB lookups & OpenAI connection while Twilio sets up media stream)
  try {
    const { prewarmAiSession } = require('../voice/voiceGateway');
    prewarmAiSession(callId).catch((err) => {
      console.warn(`[VOICE] Prewarm notice for callId=${callId}: ${err.message}`);
    });
  } catch (err) {
    console.warn(`[VOICE] Prewarm invocation notice: ${err.message}`);
  }

  res.type('text/xml').send(
    `<Response><Connect><Stream url="${streamUrl}" /></Connect></Response>`
  );
});

module.exports = router;
