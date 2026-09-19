const test = require('node:test');
const assert = require('node:assert');
const OpenAiRealtimeProvider = require('../src/voice/providers/openaiRealtimeProvider');
const VoiceSession = require('../src/voice/VoiceSession');
const { handleUpdateDisposition } = require('../src/voice/tools/updateDisposition');
const { handleEndCall } = require('../src/voice/tools/endCall');
const { sendTwilioAudio } = require('../src/voice/voiceGateway');

test('PSTN Turn-Taking, Barge-In & State Safety Regressions', async (t) => {

  await t.test('1. speech_started during AI_THINKING does not blindly change state', () => {
    const provider = new OpenAiRealtimeProvider({ callId: 'test_turn_thinking' });
    const session = new VoiceSession({ callId: 'test_turn_thinking' });
    // Proper turn sequence: CALL_CONNECTED -> WAITING_FOR_PROSPECT -> PROSPECT_SPEAKING -> AI_THINKING
    session.setConversationState('WAITING_FOR_PROSPECT');
    session.setConversationState('PROSPECT_SPEAKING');
    session.setConversationState('AI_THINKING');
    provider.conversationState = 'AI_THINKING';

    let stateChanges = [];
    provider.on('state_changed', (s) => stateChanges.push(s));

    // Simulate speech_started arriving during AI_THINKING
    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'input_audio_buffer.speech_started'
    })));

    // State MUST NOT blindly transition to PROSPECT_SPEAKING
    assert.strictEqual(provider.conversationState, 'AI_THINKING', 'Provider state must remain AI_THINKING');
    assert.strictEqual(session.conversationState, 'AI_THINKING', 'VoiceSession state must remain AI_THINKING');
    assert.strictEqual(stateChanges.length, 0, 'No state_changed events emitted for invalid transition');
  });

  await t.test('2. genuine barge-in during AI_SPEAKING cancels active response and transitions to PROSPECT_SPEAKING', () => {
    const provider = new OpenAiRealtimeProvider({ callId: 'test_bargein_speaking' });
    let cancelled = false;
    let cancelCount = 0;
    provider.isConnected = true;
    provider.ws = {
      readyState: 1,
      send: (msg) => {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'response.cancel') {
          cancelled = true;
          cancelCount++;
        }
      }
    };

    // AI is actively speaking
    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'response.created',
      response: { id: 'resp_speaking_1' }
    })));
    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'response.output_audio.delta',
      response_id: 'resp_speaking_1',
      delta: Buffer.alloc(160, 0xff).toString('base64')
    })));

    assert.strictEqual(provider.conversationState, 'AI_SPEAKING');
    assert.strictEqual(provider.activeResponse, true);

    // Prospect interrupts
    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'input_audio_buffer.speech_started'
    })));

    assert.strictEqual(provider.conversationState, 'PROSPECT_SPEAKING', 'State must transition to PROSPECT_SPEAKING on genuine barge-in');
    assert.strictEqual(cancelled, true, 'Active response must be cancelled');
    assert.strictEqual(cancelCount, 1, 'Cancelled exactly once');
    assert.strictEqual(provider.activeResponse, false);
  });

  await t.test('3. stale cancelled response cannot produce audio', () => {
    const provider = new OpenAiRealtimeProvider({ callId: 'test_stale_audio' });
    let emittedAudioDeltas = [];
    provider.on('audio', (data) => emittedAudioDeltas.push(data));

    // Cancelled response ID
    provider.cancelledResponseIds.add('resp_cancelled_999');

    // Late audio delta arrives for the cancelled response
    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'response.output_audio.delta',
      response_id: 'resp_cancelled_999',
      delta: Buffer.alloc(160, 0xff).toString('base64')
    })));

    assert.strictEqual(emittedAudioDeltas.length, 0, 'Late audio from cancelled response must be completely discarded');
  });

  await t.test('4. partial transcript cannot trigger disposition or end_call', async () => {
    const session = new VoiceSession({
      callId: 'test_safety_disposition',
      leadId: '507f1f77bcf86cd799439011'
    });
    session.durationSec = 5; // Call just started (early call)

    // Noise/hallucinated "Bye" in transcript
    session.transcript = [
      { speaker: 'customer', text: 'Bye.' }
    ];

    // Attempt to set DNC without substantive customer conversation
    const dncResult = await handleUpdateDisposition({ disposition: 'DNC', reason: 'Customer said bye' }, session);
    assert.strictEqual(dncResult.success, false, 'Premature DNC on false transcript must be rejected');
    assert.strictEqual(dncResult.blocked, true);

    // Attempt to set Not Interested without substantive customer conversation
    const niResult = await handleUpdateDisposition({ disposition: 'Not Interested', reason: 'Short refusal' }, session);
    assert.strictEqual(niResult.success, false, 'Premature Not Interested must be rejected');
    assert.strictEqual(niResult.blocked, true);

    // Attempt end_call on premature decline reason without substantive turn
    session.transcript = []; // empty or only noise
    const endResult = await handleEndCall({ reason: 'Customer hung up / bye' }, session);
    assert.strictEqual(endResult.success, false, 'Premature end_call must be blocked');
    assert.strictEqual(endResult.blocked, true);
  });

  await t.test('5. completed transcript is authoritative and substantive utterances allow valid disposition', async () => {
    const session = new VoiceSession({
      callId: 'test_authoritative_transcript',
      leadId: '507f1f77bcf86cd799439012'
    });
    session.durationSec = 25; // Genuine call duration

    // Customer actually stated they are not interested
    session.transcript = [
      { speaker: 'assistant', text: 'Hello, this is Sarah calling about debt relief.' },
      { speaker: 'customer', text: 'Please take me off your calling list, I am not interested at all.' }
    ];

    // Substantive utterance: handleUpdateDisposition should allow it (mock DB Call/Lead will be called or no-op)
    // We mock Call and Lead to verify it passes the safety check
    const Call = require('../src/models/Call');
    const Lead = require('../src/models/Lead');
    const CallEvent = require('../src/models/CallEvent');
    const origCallUpdate = Call.findOneAndUpdate;
    const origLeadUpdate = Lead.findByIdAndUpdate;
    const origCallEvent = CallEvent.create;

    let callUpdated = false;
    Call.findOneAndUpdate = async () => { callUpdated = true; return {}; };
    Lead.findByIdAndUpdate = async () => { return {}; };
    CallEvent.create = async () => { return {}; };

    try {
      const result = await handleUpdateDisposition({ disposition: 'DNC', reason: 'Explicit request' }, session);
      assert.strictEqual(result.success, true, 'Authoritative completed customer turn permits DNC');
      assert.strictEqual(callUpdated, true);
    } finally {
      Call.findOneAndUpdate = origCallUpdate;
      Lead.findByIdAndUpdate = origLeadUpdate;
      CallEvent.create = origCallEvent;
    }
  });

  await t.test('6. false/duplicate speech events do not create duplicate cancellations', () => {
    const provider = new OpenAiRealtimeProvider({ callId: 'test_dup_cancel' });
    let cancelCount = 0;
    provider.isConnected = true;
    provider.ws = {
      readyState: 1,
      send: (msg) => {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'response.cancel') cancelCount++;
      }
    };

    // AI is speaking
    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'response.created',
      response: { id: 'resp_dup_1' }
    })));
    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'response.output_audio.delta',
      response_id: 'resp_dup_1',
      delta: Buffer.alloc(160, 0xff).toString('base64')
    })));

    // First speech event
    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'input_audio_buffer.speech_started'
    })));
    assert.strictEqual(cancelCount, 1, 'First speech event triggers cancel');

    // Duplicate rapid speech event arrives immediately
    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'input_audio_buffer.speech_started'
    })));
    assert.strictEqual(cancelCount, 1, 'Duplicate speech event must NOT trigger duplicate cancel');
  });

  await t.test('7. greeting architecture connects Media Stream immediately for true bidirectional barge-in', () => {
    const session = new VoiceSession({ callId: 'test_stream_immediate' });
    // Verify that session does not rely on blocking <Say>
    assert.strictEqual(session.greetingSpokenViaTwiml, false, 'Default greetingSpokenViaTwiml must be false so stream connects immediately');

    // Opening greeting is delivered via bidirectional stream and can be interrupted
    const provider = new OpenAiRealtimeProvider({ callId: 'test_stream_immediate' });
    provider.isConnected = true;
    let greetingSent = false;
    provider.ws = {
      readyState: 1,
      send: (msg) => {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'response.create' && parsed.response?.instructions?.includes('Opening greeting')) {
          greetingSent = true;
        }
      }
    };

    provider.sendGreeting('Hi, this is Sarah.');
    assert.strictEqual(greetingSent, true, 'Greeting is generated as an OpenAI Realtime response');
    assert.strictEqual(provider.conversationState, 'INITIAL_GREETING');
  });

  await t.test('8. response latency instrumentation records lifecycle timings accurately', () => {
    const logs = [];
    const origLog = console.log;
    console.log = (...args) => logs.push(args.join(' '));

    const provider = new OpenAiRealtimeProvider({ callId: 'test_instrumentation' });
    provider.timings.t0 = Date.now() - 500;

    try {
      // 1. speech_stopped
      provider._handleServerEvent(Buffer.from(JSON.stringify({
        type: 'input_audio_buffer.speech_stopped'
      })));
      assert.ok(provider.timings.lastSpeechStoppedAt);

      // 2. response.create
      provider.ws = { readyState: 1, send: () => {} };
      provider.isConnected = true;
      provider._send({ type: 'response.create' });

      // 3. response.created
      provider._handleServerEvent(Buffer.from(JSON.stringify({
        type: 'response.created',
        response: { id: 'resp_inst_1' }
      })));
      assert.ok(provider.timings.lastResponseCreatedAt);

      // 4. first audio delta
      provider._handleServerEvent(Buffer.from(JSON.stringify({
        type: 'response.output_audio.delta',
        response_id: 'resp_inst_1',
        delta: Buffer.alloc(160, 0xff).toString('base64')
      })));
      assert.ok(provider.timings.firstDeltaPerResponse);

      // 5. transcription completed
      provider._handleServerEvent(Buffer.from(JSON.stringify({
        type: 'conversation.item.input_audio_transcription.completed',
        transcript: 'Hello there'
      })));

      // 6. response.done
      provider._handleServerEvent(Buffer.from(JSON.stringify({
        type: 'response.done',
        response: { id: 'resp_inst_1', status: 'completed' }
      })));

      const timingLogs = logs.filter(l => l.includes('[LIFECYCLE_TIMING]'));
      assert.ok(timingLogs.length >= 5, 'Must log lifecycle timing for every critical event');
      assert.ok(timingLogs.some(l => l.includes('speech_stopped')));
      assert.ok(timingLogs.some(l => l.includes('response.create sent')));
      assert.ok(timingLogs.some(l => l.includes('response.created received')));
      assert.ok(timingLogs.some(l => l.includes('first audio delta')));
      assert.ok(timingLogs.some(l => l.includes('transcription.completed')));
      assert.ok(timingLogs.some(l => l.includes('response.done')));
    } finally {
      console.log = origLog;
    }
  });

});
