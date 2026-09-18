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
        await twilioService.transferCall(call.callId, call.transferDestination, 'Twilio classified human answer');
      } else if (CallStatus === 'completed' || CallStatus === 'busy' || CallStatus === 'no-answer' || CallStatus === 'failed') {
        await twilioService.finalizeCall(call.callId, CallStatus, `Twilio call ended (${CallDuration || 0}s)`);
      }
    }
    res.sendStatus(204);
  } catch (err) {
    console.error(`[Twilio Webhook] Status handling failed: ${err.message}`);
    res.sendStatus(204);
  }
});

// Keeps the call open while Twilio's Answering Machine Detection classifies it.
router.post('/twilio/voice/:callId', (req, res) => {
  const baseUrl = (process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  const streamUrl = baseUrl.replace(/^https:/i, 'wss:') + `/api/webhooks/twilio/media/${encodeURIComponent(req.params.callId)}`;
  res.type('text/xml').send(
    `<Response><Start><Stream url="${streamUrl}" /></Start><Pause length="30" /></Response>`
  );
});

module.exports = router;
