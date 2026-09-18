const test = require('node:test');
const assert = require('node:assert');
const OpenAiRealtimeProvider = require('../src/voice/providers/openaiRealtimeProvider');

test('OpenAI Realtime GA Provider Event & Protocol Handling', async (t) => {
  const provider = new OpenAiRealtimeProvider({
    callId: 'test_call_events',
    apiKey: 'sk-test-key-mock',
    model: 'gpt-realtime-1.5',
    voice: 'alloy',
    instructions: 'You are a friendly UK assistant.'
  });

  await t.test('initializes with GA defaults and properties', () => {
    assert.strictEqual(provider.callId, 'test_call_events');
    assert.strictEqual(provider.model, 'gpt-realtime-1.5');
    assert.strictEqual(provider.voice, 'alloy');
    assert.strictEqual(provider.isConnected, false);
  });

  await t.test('verifies GA session configuration payload structure', () => {
    // Intercept _send to capture the session.update payload
    let sentPayload = null;
    const originalSend = provider._send;
    provider._send = (payload) => {
      sentPayload = payload;
    };

    provider._configureSession();
    provider._send = originalSend;

    assert.ok(sentPayload);
    assert.strictEqual(sentPayload.type, 'session.update');
    assert.strictEqual(sentPayload.session.type, 'realtime');
    assert.strictEqual(sentPayload.session.modalities, undefined, 'session.modalities must be undefined in GA');
    assert.deepStrictEqual(sentPayload.session.output_modalities, ['audio'], 'output_modalities must be ["audio"]');
    assert.strictEqual(sentPayload.session.temperature, undefined, 'temperature must be undefined in GA');
    assert.strictEqual(sentPayload.session.instructions, 'You are a friendly UK assistant.');

    // GA Audio Configuration: voice MUST be inside audio.output.voice, NOT session.voice
    assert.strictEqual(sentPayload.session.voice, undefined, 'session.voice must not exist in GA');
    assert.ok(sentPayload.session.audio);
    assert.strictEqual(sentPayload.session.audio.output.voice, 'alloy', 'voice must be under audio.output.voice');
    assert.strictEqual(sentPayload.session.audio.output.format.type, 'audio/pcmu', 'output format must be audio/pcmu');
    assert.strictEqual(sentPayload.session.audio.input.format.type, 'audio/pcmu', 'input format must be audio/pcmu');
    assert.strictEqual(sentPayload.session.audio.input.transcription.model, 'whisper-1');
    assert.strictEqual(sentPayload.session.audio.input.turn_detection.type, 'server_vad');
  });

  await t.test('formats inbound audio as input_audio_buffer.append', () => {
    let sentPayload = null;
    provider.isConnected = true;
    provider.ws = { readyState: 1 /* OPEN */, send: (str) => { sentPayload = JSON.parse(str); } };

    const success = provider.sendAudio('mock_inbound_base64_audio');
    assert.strictEqual(success, true);
    assert.strictEqual(sentPayload.type, 'input_audio_buffer.append');
    assert.strictEqual(sentPayload.audio, 'mock_inbound_base64_audio');
  });

  await t.test('handles GA session.updated and confirms GA config before emitting connected', () => {
    let connectedSessionId = null;
    provider.on('connected', ({ sessionId }) => {
      connectedSessionId = sessionId;
    });

    const mockEvent = {
      type: 'session.updated',
      session: {
        id: 'sess_12345',
        audio: {
          output: {
            format: { type: 'audio/pcmu' },
            voice: 'alloy'
          }
        }
      }
    };
    provider._handleServerEvent(Buffer.from(JSON.stringify(mockEvent)));

    assert.strictEqual(connectedSessionId, 'sess_12345');
    assert.strictEqual(provider._sessionConfigured, true);
  });

  await t.test('handles GA response.output_audio.delta and emits audio event with metadata', () => {
    let receivedAudio = null;
    provider.on('audio', (data) => {
      receivedAudio = data;
    });

    const mockEvent = {
      type: 'response.output_audio.delta',
      delta: 'mock_base64_ga_audio_payload'
    };
    provider._handleServerEvent(Buffer.from(JSON.stringify(mockEvent)));

    assert.ok(receivedAudio);
    const delta = typeof receivedAudio === 'string' ? receivedAudio : receivedAudio.delta;
    assert.strictEqual(delta, 'mock_base64_ga_audio_payload');
    assert.strictEqual(provider.isResponding, true);
  });

  await t.test('handles legacy response.audio.delta fallback for robustness', () => {
    let receivedAudio = null;
    provider.on('audio', (data) => {
      receivedAudio = data;
    });

    const mockEvent = {
      type: 'response.audio.delta',
      delta: 'mock_base64_legacy_audio_payload'
    };
    provider._handleServerEvent(Buffer.from(JSON.stringify(mockEvent)));

    const delta = typeof receivedAudio === 'string' ? receivedAudio : receivedAudio.delta;
    assert.strictEqual(delta, 'mock_base64_legacy_audio_payload');
  });

  await t.test('handles GA response.output_audio.done and sets status to listening', () => {
    let statusReceived = null;
    provider.on('status', (st) => {
      statusReceived = st;
    });

    const mockEvent = {
      type: 'response.output_audio.done'
    };
    provider._handleServerEvent(Buffer.from(JSON.stringify(mockEvent)));

    assert.strictEqual(statusReceived, 'listening');
    assert.strictEqual(provider.isResponding, false);
  });

  await t.test('handles speech_started (barge-in) and emits event', () => {
    let bargeInDetected = false;
    provider.on('speech_started', () => {
      bargeInDetected = true;
    });

    const mockEvent = {
      type: 'input_audio_buffer.speech_started',
      audio_start_ms: 500
    };
    provider._handleServerEvent(Buffer.from(JSON.stringify(mockEvent)));

    assert.strictEqual(bargeInDetected, true);
  });

  await t.test('handles customer transcription completed event', () => {
    let capturedTranscript = null;
    provider.on('transcript', (item) => {
      capturedTranscript = item;
    });

    const mockEvent = {
      type: 'conversation.item.input_audio_transcription.completed',
      transcript: 'Hello, this is John Doe.'
    };
    provider._handleServerEvent(Buffer.from(JSON.stringify(mockEvent)));

    assert.strictEqual(capturedTranscript.speaker, 'customer');
    assert.strictEqual(capturedTranscript.text, 'Hello, this is John Doe.');
  });

  await t.test('handles GA response.output_audio_transcript.done', () => {
    let capturedTranscript = null;
    provider.on('transcript', (item) => {
      capturedTranscript = item;
    });

    const mockEvent = {
      type: 'response.output_audio_transcript.done',
      transcript: 'I understand, John. We can help with your debt relief.'
    };
    provider._handleServerEvent(Buffer.from(JSON.stringify(mockEvent)));

    assert.strictEqual(capturedTranscript.speaker, 'assistant');
    assert.strictEqual(capturedTranscript.text, 'I understand, John. We can help with your debt relief.');
  });

  await t.test('handles tool call argument resolution', () => {
    let capturedTool = null;
    provider.on('tool_call', (tool) => {
      capturedTool = tool;
    });

    const mockEvent = {
      type: 'response.function_call_arguments.done',
      call_id: 'tool_call_999',
      name: 'mark_interested',
      arguments: JSON.stringify({ debtAmount: 9500, level: 'high' })
    };
    provider._handleServerEvent(Buffer.from(JSON.stringify(mockEvent)));

    assert.strictEqual(capturedTool.toolCallId, 'tool_call_999');
    assert.strictEqual(capturedTool.name, 'mark_interested');
    assert.strictEqual(capturedTool.arguments.debtAmount, 9500);
    assert.strictEqual(capturedTool.arguments.level, 'high');
  });

  await t.test('handles error events without crashing', () => {
    let capturedError = null;
    provider.on('error', (err) => {
      capturedError = err;
    });

    const mockEvent = {
      type: 'error',
      error: { message: 'Session rate limit exceeded' }
    };
    provider._handleServerEvent(Buffer.from(JSON.stringify(mockEvent)));

    assert.strictEqual(capturedError.message, 'Session rate limit exceeded');
  });

  await t.test('barge-in when active response exists cancels response safely', () => {
    let sentMessages = [];
    provider.isConnected = true;
    provider.ws = {
      readyState: 1,
      send: (msg) => { sentMessages.push(JSON.parse(msg)); }
    };

    // Simulate AI response starting
    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'response.created',
      response: { id: 'resp_barge_in_test' }
    })));

    assert.strictEqual(provider.activeResponse, true);
    assert.strictEqual(provider.activeResponseId, 'resp_barge_in_test');

    // Customer interrupts / speech starts
    let bargeInData = null;
    const onSpeechStarted = (data) => { bargeInData = data; };
    provider.once('speech_started', onSpeechStarted);

    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'input_audio_buffer.speech_started'
    })));

    assert.ok(bargeInData);
    assert.strictEqual(bargeInData.wasResponding, true);
    assert.strictEqual(provider.activeResponse, false);

    const cancelMsg = sentMessages.find(m => m.type === 'response.cancel');
    assert.ok(cancelMsg, 'Must send response.cancel when active response exists');
  });

  await t.test('barge-in when no active response exists does NOT send response.cancel', () => {
    let sentMessages = [];
    provider.isConnected = true;
    provider.activeResponse = false;
    provider.activeResponseId = null;
    provider.isResponding = false;
    provider.ws = {
      readyState: 1,
      send: (msg) => { sentMessages.push(JSON.parse(msg)); }
    };

    let bargeInData = null;
    provider.once('speech_started', (data) => { bargeInData = data; });

    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'input_audio_buffer.speech_started'
    })));

    assert.ok(bargeInData);
    assert.strictEqual(bargeInData.wasResponding, false);

    const cancelMsg = sentMessages.find(m => m.type === 'response.cancel');
    assert.strictEqual(cancelMsg, undefined, 'Must not send response.cancel when no active response exists');
  });

  await t.test('repeated speech-start events do NOT send duplicate cancellations', () => {
    let cancelCount = 0;
    provider.isConnected = true;
    provider.ws = {
      readyState: 1,
      send: (msg) => {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'response.cancel') cancelCount++;
      }
    };

    // Simulate AI response starting
    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'response.created',
      response: { id: 'resp_duplicate_test' }
    })));

    // Rapid successive speech_started events
    provider._handleServerEvent(Buffer.from(JSON.stringify({ type: 'input_audio_buffer.speech_started' })));
    provider._handleServerEvent(Buffer.from(JSON.stringify({ type: 'input_audio_buffer.speech_started' })));
    provider._handleServerEvent(Buffer.from(JSON.stringify({ type: 'input_audio_buffer.speech_started' })));

    assert.strictEqual(cancelCount, 1, 'Only one response.cancel must be sent for repeated barge-in triggers');
  });

  await t.test('suppresses benign cancellation race errors without treating as provider error', () => {
    let errorEmitted = false;
    const onError = () => { errorEmitted = true; };
    provider.on('error', onError);

    // Simulate OpenAI returning benign race cancellation error
    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'error',
      error: {
        type: 'invalid_request_error',
        code: null,
        message: 'Cancellation failed: no active response found'
      }
    })));

    assert.strictEqual(errorEmitted, false, 'Cancellation failed error must be suppressed as benign notice');
    provider.removeListener('error', onError);
  });

  await t.test('cleans up resources on close', () => {
    let closedEvent = false;
    provider.on('closed', () => {
      closedEvent = true;
    });
    provider.close();
    assert.strictEqual(provider.isConnected, false);
    assert.strictEqual(closedEvent, true);
  });
});

test('VoiceGateway Twilio Media & Audio Codec Validation', async (t) => {
  const { sendTwilioAudio, sendTwilioClear } = require('../src/voice/voiceGateway');

  // Sample 160-byte PCMU payload (20ms of silence / standard telephony mu-law)
  const sampleRawBytes = Buffer.alloc(160, 0xff); // 0xff is standard silence in G.711 u-law
  const sampleBase64 = sampleRawBytes.toString('base64');

  await t.test('exact Twilio outbound media message structure and no base64 double encoding', () => {
    let sentPayload = null;
    const mockSession = {
      callId: 'test_call_media_structure',
      twilioStreamSid: 'MZ1234567890abcdef',
      twilioSocket: {
        readyState: 1, // OPEN
        send: (msg) => { sentPayload = JSON.parse(msg); }
      },
      hasLoggedCodecDebug: true
    };

    const success = sendTwilioAudio(mockSession, {
      delta: sampleBase64,
      eventType: 'response.output_audio.delta'
    });

    assert.strictEqual(success, true);
    assert.ok(sentPayload);
    assert.strictEqual(sentPayload.event, 'media');
    assert.strictEqual(sentPayload.streamSid, 'MZ1234567890abcdef');
    assert.ok(sentPayload.media);
    assert.strictEqual(typeof sentPayload.media.payload, 'string');
    // Verify NO base64 double-encoding: payload MUST be identical to sampleBase64
    assert.strictEqual(sentPayload.media.payload, sampleBase64);
    assert.strictEqual(Buffer.from(sentPayload.media.payload, 'base64').length, 160);
  });

  await t.test('codec diagnostics logs exact format for ONE audio chunk only', () => {
    const logs = [];
    const originalConsoleLog = console.log;
    console.log = (...args) => { logs.push(args.join(' ')); };

    const mockSession = {
      callId: 'test_call_codec_debug',
      twilioStreamSid: 'MZ_codec_debug_stream',
      twilioSocket: {
        readyState: 1,
        send: () => {}
      },
      hasLoggedCodecDebug: false
    };

    try {
      // First chunk - should trigger diagnostic log
      sendTwilioAudio(mockSession, {
        delta: sampleBase64,
        eventType: 'response.output_audio.delta'
      });

      const debugLog = logs.find(l => l.includes('[VOICE CODEC DEBUG]'));
      assert.ok(debugLog, 'Must emit [VOICE CODEC DEBUG] log');
      assert.ok(debugLog.includes('event=response.output_audio.delta'));
      assert.ok(debugLog.includes('format=audio/pcmu'));
      assert.ok(debugLog.includes(`base64Length=${sampleBase64.length}`));
      assert.ok(debugLog.includes('decodedBytes=160'));
      assert.ok(debugLog.includes('first16Hex=ffffffffffffffffffffffffffffffff'));
      assert.ok(debugLog.includes('last16Hex=ffffffffffffffffffffffffffffffff'));
      assert.ok(debugLog.includes('streamSid=MZ_codec_debug_stream'));

      // Verify it does NOT log the entire audio payload
      assert.strictEqual(debugLog.includes(sampleBase64), false);

      // Second chunk - should NOT trigger diagnostic log again
      const logsBeforeSecond = logs.length;
      sendTwilioAudio(mockSession, {
        delta: sampleBase64,
        eventType: 'response.output_audio.delta'
      });

      const secondDebugLog = logs.slice(logsBeforeSecond).find(l => l.includes('[VOICE CODEC DEBUG]'));
      assert.strictEqual(secondDebugLog, undefined, 'Must only log codec diagnostic for ONE audio chunk');
    } finally {
      console.log = originalConsoleLog;
    }
  });

  await t.test('Twilio clear message flushes buffer on customer barge-in', () => {
    let sentClear = null;
    const mockSession = {
      twilioStreamSid: 'MZ_clear_test_sid',
      twilioSocket: {
        readyState: 1,
        send: (msg) => { sentClear = JSON.parse(msg); }
      },
      hasBufferedAudio: true
    };

    const cleared = sendTwilioClear(mockSession);
    assert.strictEqual(cleared, true);
    assert.ok(sentClear);
    assert.strictEqual(sentClear.event, 'clear');
    assert.strictEqual(sentClear.streamSid, 'MZ_clear_test_sid');
    assert.strictEqual(mockSession.hasBufferedAudio, false);
  });
});

test('Initial Greeting Lifecycle & Startup Latency Validation', async (t) => {
  const { sendTwilioAudio } = require('../src/voice/voiceGateway');

  await t.test('initial greeting is triggered with explicit first-turn instructions and sets INITIAL_GREETING state', () => {
    const provider = new OpenAiRealtimeProvider({ callId: 'test_greeting_flow' });
    let sentPayload = null;
    provider.isConnected = true;
    provider.ws = {
      readyState: 1,
      send: (msg) => { sentPayload = JSON.parse(msg); }
    };

    provider.sendGreeting('Hi, this is Sarah from Resolute Debt Advisory.');

    assert.strictEqual(provider.conversationState, 'INITIAL_GREETING');
    assert.strictEqual(provider.isInitialGreeting, true);
    assert.ok(sentPayload);
    assert.strictEqual(sentPayload.type, 'response.create');
    assert.ok(sentPayload.response.instructions.includes('Start the call immediately. Do not wait for the prospect to speak. Deliver the opening greeting naturally, then stop and wait for the prospect.'));
    assert.ok(sentPayload.response.instructions.includes('Hi, this is Sarah from Resolute Debt Advisory.'));
    assert.ok(provider.timings.t3 > 0, 'Must record T3 timestamp for greeting request');
  });

  await t.test('initial greeting does not require customer audio to trigger', () => {
    const provider = new OpenAiRealtimeProvider({ callId: 'test_no_customer_audio' });
    let sentAudioAppends = 0;
    let greetingSent = false;
    provider.isConnected = true;
    provider.ws = {
      readyState: 1,
      send: (msg) => {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'input_audio_buffer.append') sentAudioAppends++;
        if (parsed.type === 'response.create') greetingSent = true;
      }
    };

    // Greeting triggered directly after session ready without appending customer audio
    provider.sendGreeting('Test greeting without customer audio');
    assert.strictEqual(greetingSent, true);
    assert.strictEqual(sentAudioAppends, 0, 'No customer audio should be required to start greeting');
  });

  await t.test('initial greeting transitions to WAITING_FOR_PROSPECT after response completion', () => {
    const provider = new OpenAiRealtimeProvider({ callId: 'test_greeting_completion' });
    provider.isConnected = true;
    provider.ws = { readyState: 1, send: () => {} };

    provider.sendGreeting('Greeting in progress');
    assert.strictEqual(provider.conversationState, 'INITIAL_GREETING');
    assert.strictEqual(provider.isInitialGreeting, true);

    // AI finishes generating greeting response
    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'response.done'
    })));

    assert.strictEqual(provider.conversationState, 'WAITING_FOR_PROSPECT');
    assert.strictEqual(provider.isInitialGreeting, false);
    assert.strictEqual(provider.isResponding, false);
  });

  await t.test('transient speech_started does not cancel initial greeting', () => {
    const provider = new OpenAiRealtimeProvider({ callId: 'test_transient_speech' });
    let cancelCount = 0;
    provider.isConnected = true;
    provider.ws = {
      readyState: 1,
      send: (msg) => {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'response.cancel') cancelCount++;
      }
    };

    // Start initial greeting
    provider.sendGreeting('Greeting test');
    provider.activeResponse = true;

    // Line noise / transient cough occurs (<800ms)
    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'input_audio_buffer.speech_started'
    })));

    // Must NOT cancel immediately!
    assert.strictEqual(cancelCount, 0, 'Must not cancel initial greeting immediately on speech_started');
    assert.strictEqual(provider.activeResponse, true);

    // Noise stops quickly
    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'input_audio_buffer.speech_stopped'
    })));

    assert.strictEqual(cancelCount, 0, 'Must not cancel initial greeting after transient noise stops');
    assert.strictEqual(provider.isInitialGreeting, true);

    // Clean up
    provider.close();
  });

  await t.test('sustained speech during initial greeting triggers genuine interruption cancellation', async () => {
    const provider = new OpenAiRealtimeProvider({ callId: 'test_sustained_interruption' });
    let cancelSent = false;
    provider.isConnected = true;
    provider.ws = {
      readyState: 1,
      send: (msg) => {
        const parsed = JSON.parse(msg);
        if (parsed.type === 'response.cancel') cancelSent = true;
      }
    };

    provider.sendGreeting('Greeting test');
    provider.activeResponse = true;

    // Prospect genuinely speaks and continues speaking (>800ms)
    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'input_audio_buffer.speech_started'
    })));

    assert.strictEqual(cancelSent, false);

    // Wait for the 800ms sustained interruption threshold
    await new Promise(resolve => setTimeout(resolve, 850));

    assert.strictEqual(cancelSent, true, 'Sustained speech must cancel initial greeting');
    assert.strictEqual(provider.isInitialGreeting, false);

    provider.close();
  });

  await t.test('latency instrumentation records T0 to T5 and logs calculated metrics', () => {
    const logs = [];
    const originalConsoleLog = console.log;
    console.log = (...args) => { logs.push(args.join(' ')); };

    const t0 = 1000;
    const mockSession = {
      callId: 'test_latency_call',
      twilioStreamSid: 'MZ_latency_sid',
      twilioSocket: { readyState: 1, send: () => {} },
      hasLoggedCodecDebug: true,
      hasLoggedLatency: false,
      timings: {
        t0,
        t1: t0 + 120, // OpenAI connect: 120ms
        t2: t0 + 200, // Session updated: 80ms
        t3: t0 + 210, // Greeting requested: 10ms
        t4: t0 + 450  // First audio delta: 240ms
      }
    };

    try {
      const samplePayload = Buffer.alloc(160, 0xff).toString('base64');
      sendTwilioAudio(mockSession, {
        delta: samplePayload,
        eventType: 'response.output_audio.delta'
      });

      assert.ok(mockSession.timings.t5 >= mockSession.timings.t4, 'T5 must be recorded');
      assert.strictEqual(mockSession.hasLoggedLatency, true);

      const latencyLog = logs.find(l => l.includes('[VOICE LATENCY]'));
      assert.ok(latencyLog, 'Must output [VOICE LATENCY] log');
      assert.ok(latencyLog.includes('streamConnectedMs=0'));
      assert.ok(latencyLog.includes('openAIConnectedMs=120'));
      assert.ok(latencyLog.includes('sessionUpdatedMs=200'));
      assert.ok(latencyLog.includes('greetingRequestedMs=210'));
      assert.ok(latencyLog.includes('firstAudioDeltaMs=450'));
      assert.ok(latencyLog.includes('openAIConnectLatency=120ms'));
      assert.ok(latencyLog.includes('sessionUpdateLatency=80ms'));
      assert.ok(latencyLog.includes('greetingGenerationLatency=240ms'));
      assert.ok(latencyLog.includes('totalTimeToFirstAudio='));
    } finally {
      console.log = originalConsoleLog;
    }
  });
});

test('Task H: Production Voice Lifecycle, State Machine, Barge-In & End-Call Validation', async (t) => {
  const VoiceSession = require('../src/voice/VoiceSession');
  const { handleEndCall } = require('../src/voice/tools/endCall');
  const { sendTwilioAudio, sendTwilioClear, handleTwilioEvent } = require('../src/voice/voiceGateway');

  await t.test('1. Initial greeting happens exactly once', () => {
    const session = new VoiceSession({ callId: 'test_greeting_once' });
    session.twilioStreamSid = 'MZ_greeting_once';
    let greetingCount = 0;

    const mockProvider = {
      isConnected: true,
      sendGreeting: () => { greetingCount++; }
    };
    session.setAiProvider(mockProvider);

    // First trigger
    if (session.twilioStreamSid && !session.hasGreeted) {
      session.hasGreeted = true;
      session.setConversationState('INITIAL_GREETING');
      mockProvider.sendGreeting();
    }

    // Second event should NOT trigger again
    if (session.twilioStreamSid && !session.hasGreeted) {
      session.hasGreeted = true;
      mockProvider.sendGreeting();
    }

    assert.strictEqual(greetingCount, 1, 'Initial greeting must only trigger once');
    assert.strictEqual(session.conversationState, 'INITIAL_GREETING');
  });

  await t.test('2. AI does not wait for prospect before greeting', () => {
    const provider = new OpenAiRealtimeProvider({ callId: 'test_immediate_greeting' });
    let sentPayload = null;
    provider.isConnected = true;
    provider.ws = {
      readyState: 1,
      send: (msg) => { sentPayload = JSON.parse(msg); }
    };

    provider.sendGreeting('Hi, this is Sarah.');

    assert.ok(sentPayload);
    assert.strictEqual(sentPayload.type, 'response.create');
    assert.ok(sentPayload.response.instructions.includes('Start the call immediately. Do not wait for the prospect to speak.'));
    assert.strictEqual(provider.conversationState, 'INITIAL_GREETING');
  });

  await t.test('3. speech_started does not falsely mark AI response complete', () => {
    const provider = new OpenAiRealtimeProvider({ callId: 'test_speech_started_state' });
    provider.isConnected = true;
    provider.activeResponse = true;
    provider.isResponding = true;
    provider.isInitialGreeting = false;
    provider.ws = { readyState: 1, send: () => {} };

    // Prospect starts speaking
    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'input_audio_buffer.speech_started'
    })));

    // Conversation state must be PROSPECT_SPEAKING, NOT WAITING_FOR_PROSPECT
    assert.strictEqual(provider.conversationState, 'PROSPECT_SPEAKING');
    assert.notStrictEqual(provider.conversationState, 'WAITING_FOR_PROSPECT', 'speech_started must not transition to WAITING_FOR_PROSPECT');
  });

  await t.test('4. Genuine barge-in clears Twilio', () => {
    let sentTwilioMessage = null;
    const session = new VoiceSession({ callId: 'test_bargein_clear' });
    session.twilioStreamSid = 'MZ_bargein_sid';
    session.twilioSocket = {
      readyState: 1,
      send: (msg) => { sentTwilioMessage = JSON.parse(msg); }
    };
    session.hasBufferedAudio = true;

    const cleared = sendTwilioClear(session);
    assert.strictEqual(cleared, true);
    assert.ok(sentTwilioMessage);
    assert.strictEqual(sentTwilioMessage.event, 'clear');
    assert.strictEqual(sentTwilioMessage.streamSid, 'MZ_bargein_sid');
    assert.strictEqual(session.hasBufferedAudio, false);
  });

  await t.test('5. Genuine barge-in cancels only the active response', () => {
    const provider = new OpenAiRealtimeProvider({ callId: 'test_bargein_cancel' });
    let sentCancel = null;
    provider.isConnected = true;
    provider.ws = {
      readyState: 1,
      send: (msg) => { sentCancel = JSON.parse(msg); }
    };

    // Active response created
    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'response.created',
      response: { id: 'resp_bargein_target' }
    })));

    assert.strictEqual(provider.activeResponseId, 'resp_bargein_target');

    // Barge-in occurs
    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'input_audio_buffer.speech_started'
    })));

    assert.ok(sentCancel);
    assert.strictEqual(sentCancel.type, 'response.cancel');
    assert.ok(provider.cancelledResponseIds.has('resp_bargein_target'));
  });

  await t.test('6. Late audio from cancelled response is discarded', () => {
    const provider = new OpenAiRealtimeProvider({ callId: 'test_stale_audio' });
    provider.isConnected = true;
    provider.ws = { readyState: 1, send: () => {} };

    // Set up cancelled response ID
    provider.cancelledResponseIds.add('resp_cancelled_123');

    let audioEmitted = false;
    provider.on('audio', () => { audioEmitted = true; });

    // Late audio delta arrives for the cancelled response
    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'response.output_audio.delta',
      response_id: 'resp_cancelled_123',
      delta: Buffer.alloc(160, 0xff).toString('base64')
    })));

    assert.strictEqual(audioEmitted, false, 'Late audio belonging to cancelled response must be discarded');
  });

  await t.test('7. A new AI response can start after barge-in', () => {
    const provider = new OpenAiRealtimeProvider({ callId: 'test_new_response_after_bargein' });
    provider.isConnected = true;
    provider.ws = { readyState: 1, send: () => {} };

    // 1. Initial response cancelled
    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'response.created',
      response: { id: 'resp_old_cancelled' }
    })));
    provider.clearAudio();
    assert.strictEqual(provider.activeResponse, false);

    // 2. Prospect finishes speaking
    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'input_audio_buffer.speech_stopped'
    })));
    assert.strictEqual(provider.conversationState, 'AI_THINKING');

    // 3. New response starts
    let newAudioReceived = false;
    provider.on('audio', (data) => {
      if (data.responseId === 'resp_new_fresh') newAudioReceived = true;
    });

    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'response.created',
      response: { id: 'resp_new_fresh' }
    })));

    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'response.output_audio.delta',
      response_id: 'resp_new_fresh',
      delta: Buffer.alloc(160, 0xff).toString('base64')
    })));

    assert.strictEqual(newAudioReceived, true, 'New response audio must be received and processed after barge-in');
    assert.strictEqual(provider.conversationState, 'AI_SPEAKING');
  });

  await t.test('8. end_call does NOT hang up while AI audio is still playing', async () => {
    const session = new VoiceSession({ callId: 'test_endcall_deferred' });
    session.aiProvider = { isResponding: true, activeResponse: true };
    session.hasBufferedAudio = true;

    let hangupExecuted = false;
    session.executeHangup = async () => { hangupExecuted = true; };

    const result = await handleEndCall({ reason: 'Prospect not interested' }, session);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.pending, true, 'End call must return pending=true when audio is playing');
    assert.strictEqual(session.isEnding, true);
    assert.strictEqual(session.conversationState, 'ENDING');
    assert.strictEqual(hangupExecuted, false, 'executeHangup must NOT be called immediately while audio is playing');
  });

  await t.test('9. end_call waits for Twilio playback mark', async () => {
    const session = new VoiceSession({ callId: 'test_endcall_mark_wait' });
    session.twilioStreamSid = 'MZ_endcall_mark_sid';
    let sentMarkName = null;
    session.twilioSocket = {
      readyState: 1,
      send: (msg) => {
        const parsed = JSON.parse(msg);
        if (parsed.event === 'mark') sentMarkName = parsed.mark.name;
      }
    };

    session.isEnding = true;
    session.endCallReason = 'Completed conversation';
    let hangupExecuted = false;
    session.executeHangup = async () => { hangupExecuted = true; };

    // Simulate AI finishing audio generation (response_done)
    const endMarkName = `end_call_${Date.now()}`;
    session.pendingEndMark = endMarkName;
    session.sendTwilioMark(endMarkName);

    assert.strictEqual(sentMarkName, endMarkName);
    assert.strictEqual(hangupExecuted, false, 'Must not hang up before Twilio mark arrives');

    // Simulate Twilio echoing mark back after PSTN audio completes
    await handleTwilioEvent({
      event: 'mark',
      mark: { name: endMarkName }
    }, session);

    assert.strictEqual(hangupExecuted, true, 'Must execute hangup after Twilio mark is confirmed');
    assert.strictEqual(session.conversationState, 'ENDED');
  });

  await t.test('10. duplicate end_call is prevented', async () => {
    const session = new VoiceSession({ callId: 'test_duplicate_endcall' });
    session.isEnding = true;
    session.endCallReason = 'First attempt';

    let hangupCount = 0;
    session.executeHangup = async () => { hangupCount++; };

    const result = await handleEndCall({ reason: 'Second attempt' }, session);

    assert.strictEqual(result.success, true);
    assert.strictEqual(result.ended, true);
    assert.strictEqual(result.message, 'Call termination already in progress');
    assert.strictEqual(hangupCount, 0, 'No extra hangup should be executed');
  });

  await t.test('11. startup latency instrumentation works (T0 to T6)', () => {
    const t0 = 1000;
    const session = new VoiceSession({ callId: 'test_t6_instrumentation' });
    session.twilioStreamSid = 'MZ_t6_sid';
    session.timings = {
      t0,
      t1: t0 + 100,
      t2: t0 + 180,
      t3: t0 + 200,
      t4: t0 + 400,
      t5: t0 + 405
    };

    const logs = [];
    const origLog = console.log;
    console.log = (...args) => { logs.push(args.join(' ')); };

    try {
      // Simulate Twilio acknowledging playback with greeting_mark_initial
      handleTwilioEvent({
        event: 'mark',
        mark: { name: 'greeting_mark_initial' }
      }, session);

      assert.ok(session.timings.t6 >= session.timings.t5);
      const t6Log = logs.find(l => l.includes('[VOICE LATENCY] T6 greeting played on PSTN'));
      assert.ok(t6Log, 'Must emit T6 latency log');
      assert.ok(t6Log.includes('twilioPlayoutLatency='));
      assert.ok(t6Log.includes('totalPSTNLatency='));
    } finally {
      console.log = origLog;
    }
  });
});

test('Production State-Machine Race Conditions & Prewarm Lifecycle (Critical Bugs 1-10)', async (t) => {
  const VoiceSession = require('../src/voice/VoiceSession');
  const sessionManager = require('../src/voice/sessionManager');
  const { handleEndCall } = require('../src/voice/tools/endCall');
  const { executeTool } = require('../src/voice/tools/toolRegistry');
  const { sendTwilioAudio, handleTwilioEvent, prewarmAiSession, handleTwilioConnection } = require('../src/voice/voiceGateway');

  await t.test('1. ENDING never transitions to WAITING_FOR_PROSPECT', () => {
    const session = new VoiceSession({ callId: 'test_ending_terminal' });
    session.setConversationState('ENDING');
    assert.strictEqual(session.conversationState, 'ENDING');

    // Attempt forbidden transition
    const success = session.setConversationState('WAITING_FOR_PROSPECT');
    assert.strictEqual(success, false);
    assert.strictEqual(session.conversationState, 'ENDING', 'Must remain ENDING');

    // Also verify attempt to AI_THINKING, AI_SPEAKING, PROSPECT_SPEAKING fail
    assert.strictEqual(session.setConversationState('AI_THINKING'), false);
    assert.strictEqual(session.setConversationState('AI_SPEAKING'), false);
    assert.strictEqual(session.setConversationState('PROSPECT_SPEAKING'), false);
    assert.strictEqual(session.conversationState, 'ENDING');
  });

  await t.test('2. ENDING blocks response.create', () => {
    const provider = new OpenAiRealtimeProvider({ callId: 'test_ending_blocks_create' });
    let sentMessages = [];
    provider.isConnected = true;
    provider.ws = {
      readyState: 1,
      send: (msg) => { sentMessages.push(JSON.parse(msg)); }
    };

    provider.setEnding(true);
    assert.strictEqual(provider.conversationState, 'ENDING');

    // Attempt response.create directly
    provider._send({ type: 'response.create' });
    assert.strictEqual(sentMessages.length, 0, 'response.create must be blocked when session is ENDING');

    // Attempt greeting response.create
    provider.sendGreeting('Goodbye test');
    assert.strictEqual(sentMessages.length, 0, 'sendGreeting must be blocked when session is ENDING');
  });

  await t.test('3. ENDING blocks tool-driven follow-up response.create', () => {
    const provider = new OpenAiRealtimeProvider({ callId: 'test_ending_blocks_tool_create' });
    let sentMessages = [];
    provider.isConnected = true;
    provider.ws = {
      readyState: 1,
      send: (msg) => { sentMessages.push(JSON.parse(msg)); }
    };

    provider.setEnding(true);

    // Send tool result
    provider.sendToolResult('call_save_notes_1', { success: true });

    // conversation.item.create MUST be sent
    const itemMsg = sentMessages.find(m => m.type === 'conversation.item.create');
    assert.ok(itemMsg, 'Must send function_call_output item even when ending');

    // response.create MUST NOT be sent
    const responseCreateMsg = sentMessages.find(m => m.type === 'response.create');
    assert.strictEqual(responseCreateMsg, undefined, 'Must NOT trigger response.create for tool result when ending');
  });

  await t.test('4. ENDED ignores response.create', () => {
    const provider = new OpenAiRealtimeProvider({ callId: 'test_ended_blocks_create' });
    let sentMessages = [];
    provider.isConnected = true;
    provider.ws = {
      readyState: 1,
      send: (msg) => { sentMessages.push(JSON.parse(msg)); }
    };

    provider.setEnded(true);
    assert.strictEqual(provider.conversationState, 'ENDED');

    provider._send({ type: 'response.create' });
    assert.strictEqual(sentMessages.length, 0, 'Must ignore response.create when ENDED');
  });

  await t.test('5. ENDED ignores audio', () => {
    const session = new VoiceSession({ callId: 'test_ended_ignores_audio' });
    session.twilioStreamSid = 'MZ_ended_sid';
    session.twilioSocket = { readyState: 1, send: () => {} };
    session.setConversationState('ENDED');

    const audioSent = sendTwilioAudio(session, { delta: Buffer.alloc(160, 0xff).toString('base64') });
    assert.strictEqual(audioSent, false, 'sendTwilioAudio must return false when session is ENDED');

    const provider = new OpenAiRealtimeProvider({ callId: 'test_provider_ended_audio' });
    provider.setEnded(true);
    const audioAppended = provider.sendAudio('mock_payload');
    assert.strictEqual(audioAppended, false, 'sendAudio must return false when provider is ENDED');
  });

  await t.test('6. ENDED ignores speech events', () => {
    const provider = new OpenAiRealtimeProvider({ callId: 'test_ended_speech' });
    provider.setEnded(true);

    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'input_audio_buffer.speech_started'
    })));
    assert.strictEqual(provider.conversationState, 'ENDED', 'Must not transition on speech_started');

    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'input_audio_buffer.speech_stopped'
    })));
    assert.strictEqual(provider.conversationState, 'ENDED', 'Must not transition on speech_stopped');
  });

  await t.test('7. ENDED cannot transition to any other state', () => {
    const session = new VoiceSession({ callId: 'test_ended_permanent' });
    session.setConversationState('ENDED');

    const forbiddenStates = [
      'CALL_CONNECTED',
      'INITIAL_GREETING',
      'AI_SPEAKING',
      'WAITING_FOR_PROSPECT',
      'PROSPECT_SPEAKING',
      'AI_THINKING',
      'ENDING'
    ];

    for (const targetState of forbiddenStates) {
      const allowed = session.setConversationState(targetState);
      assert.strictEqual(allowed, false, `Must reject transition ENDED -> ${targetState}`);
      assert.strictEqual(session.conversationState, 'ENDED');
    }
  });

  await t.test('8. Cancelled response.done cannot change state', () => {
    const provider = new OpenAiRealtimeProvider({ callId: 'test_cancelled_done_no_state_change' });
    provider.conversationState = 'PROSPECT_SPEAKING';
    provider.cancelledResponseIds.add('resp_cancelled_abc');

    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'response.done',
      response: { id: 'resp_cancelled_abc' }
    })));

    assert.strictEqual(provider.conversationState, 'PROSPECT_SPEAKING', 'Cancelled response.done must NOT transition state');
  });

  await t.test('9. Stale response events cannot change state', () => {
    const provider = new OpenAiRealtimeProvider({ callId: 'test_stale_response_events' });
    provider.currentResponseId = 'resp_active_current';
    provider.conversationState = 'PROSPECT_SPEAKING';

    // Stale response from previous turn arrives
    provider._handleServerEvent(Buffer.from(JSON.stringify({
      type: 'response.done',
      response: { id: 'resp_stale_old' }
    })));

    assert.strictEqual(provider.conversationState, 'PROSPECT_SPEAKING', 'Stale response.done must NOT transition state');
  });

  await t.test('10. end_call remains idempotent', async () => {
    const session = new VoiceSession({ callId: 'test_end_call_idempotent' });
    session.aiProvider = { isResponding: true, setEnding: () => {} };

    let hangupCalls = 0;
    session.executeHangup = async () => { hangupCalls++; };

    const first = await handleEndCall({ reason: 'First call' }, session);
    assert.strictEqual(first.success, true);
    assert.strictEqual(first.pending, true);
    assert.strictEqual(session.isEnding, true);

    const second = await handleEndCall({ reason: 'Second call' }, session);
    assert.strictEqual(second.success, true);
    assert.strictEqual(second.ended, true);
    assert.strictEqual(second.message, 'Call termination already in progress');
    assert.strictEqual(hangupCalls, 0);
  });

  await t.test('11. Twilio mark still causes the final hangup', async () => {
    const session = new VoiceSession({ callId: 'test_mark_hangup' });
    session.twilioStreamSid = 'MZ_mark_hangup_sid';
    session.isEnding = true;
    session.endCallReason = 'Prospect requested end';
    session.pendingEndMark = 'end_call_sync_999';

    let hangupReason = null;
    session.executeHangup = async (reason) => { hangupReason = reason; };

    await handleTwilioEvent({
      event: 'mark',
      mark: { name: 'end_call_sync_999' }
    }, session);

    assert.strictEqual(hangupReason, 'Prospect requested end');
    assert.strictEqual(session.conversationState, 'ENDED');
    assert.strictEqual(session.pendingEndMark, null);
  });

  await t.test('12. Final audio is still fully sent before mark', () => {
    const session = new VoiceSession({ callId: 'test_final_audio_sent' });
    session.twilioStreamSid = 'MZ_final_audio_sid';
    const sentMessages = [];
    session.twilioSocket = {
      readyState: 1,
      send: (msg) => { sentMessages.push(JSON.parse(msg)); }
    };
    session.isEnding = true;
    session.conversationState = 'ENDING';

    const rawPayload = Buffer.alloc(160, 0xff).toString('base64');
    const forwarded = sendTwilioAudio(session, {
      delta: rawPayload,
      eventType: 'response.output_audio.delta'
    });

    assert.strictEqual(forwarded, true, 'Audio must still be forwarded while session is ENDING');
    const mediaMsg = sentMessages.find(m => m.event === 'media');
    assert.ok(mediaMsg);
    assert.strictEqual(mediaMsg.media.payload, rawPayload);
  });

  await t.test('13. Exactly one OpenAI session is created per call', async () => {
    const callId = `test_single_session_${Date.now()}`;
    const session1 = sessionManager.getOrCreateSession({ callId });
    const session2 = sessionManager.getOrCreateSession({ callId });

    assert.strictEqual(session1, session2, 'sessionManager must return the exact same instance for the same callId');
    sessionManager.removeSession(callId);
  });

  await t.test('14. Prewarmed OpenAI session is reused by Twilio stream', () => {
    const callId = `test_prewarm_reuse_${Date.now()}`;
    const prewarmedSession = sessionManager.getOrCreateSession({ callId });
    const mockProvider = { isConnected: false };
    prewarmedSession.aiProvider = mockProvider;

    const mockTwilioSocket = { callId, on: () => {} };
    handleTwilioConnection(mockTwilioSocket, {});

    const retrievedSession = sessionManager.getSessionByCallId(callId);
    assert.strictEqual(retrievedSession, prewarmedSession, 'Twilio connection must reuse the prewarmed session');
    assert.strictEqual(retrievedSession.aiProvider, mockProvider, 'Must retain existing AI provider');
    assert.strictEqual(retrievedSession.twilioSocket, mockTwilioSocket, 'Must bind twilioSocket to prewarmed session');

    sessionManager.removeSession(callId);
  });

  await t.test('15. No second OpenAI connection is created', async () => {
    const callId = `test_no_second_conn_${Date.now()}`;
    const session = sessionManager.getOrCreateSession({ callId });
    let providerCreationCount = 0;

    session.setupPromise = Promise.resolve().then(() => {
      providerCreationCount++;
      const provider = { isConnected: true, callId };
      session.aiProvider = provider;
      return provider;
    });

    // Simultaneously prewarm and connect twilio
    await Promise.all([
      prewarmAiSession(callId),
      prewarmAiSession(callId)
    ]);

    assert.strictEqual(providerCreationCount, 1, 'Only one provider setup must execute');
    sessionManager.removeSession(callId);
  });
});
