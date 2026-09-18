const test = require('node:test');
const assert = require('node:assert');
const sessionManager = require('../src/voice/sessionManager');
const VoiceSession = require('../src/voice/VoiceSession');

test('VoiceSession & SessionManager Lifecycle', async (t) => {
  const callId = 'test_call_' + Date.now();
  const streamSid = 'MZ_test_stream_' + Date.now();

  await t.test('creates new session', () => {
    const session = sessionManager.createSession({ callId });
    assert(session instanceof VoiceSession);
    assert.strictEqual(session.callId, callId);
    assert.strictEqual(session.status, 'initiating');
    assert.strictEqual(session.aiStatus, 'idle');
    assert.strictEqual(sessionManager.getSessionByCallId(callId), session);
  });

  await t.test('registers and retrieves streamSid', () => {
    sessionManager.registerStreamSid(callId, streamSid);
    const session = sessionManager.getSessionByStreamSid(streamSid);
    assert.strictEqual(session.callId, callId);
    assert.strictEqual(session.twilioStreamSid, streamSid);
  });

  await t.test('tracks duration timer without crashing', async () => {
    const session = sessionManager.getSessionByCallId(callId);
    session.startDurationTimer();
    assert.strictEqual(session.status, 'active');
    assert(session.connectedAt instanceof Date);

    // Wait a brief moment
    await new Promise((resolve) => setTimeout(resolve, 50));
    session.stopDurationTimer();
    assert.strictEqual(session.durationInterval, null);
  });

  await t.test('aggregates transcript items and normalizes roles', () => {
    const session = sessionManager.getSessionByCallId(callId);
    session.addTranscriptItem({ speaker: 'customer', text: 'Hello, who is calling?' });
    session.addTranscriptItem({ speaker: 'assistant', text: 'Hi, this is Sarah from Beacon Debt Advisory.' });
    session.addTranscriptItem({ speaker: 'user', text: 'Yes, I have some credit card debt.' });

    assert.strictEqual(session.transcript.length, 3);
    assert.strictEqual(session.transcript[0].speaker, 'customer');
    assert.strictEqual(session.transcript[1].speaker, 'assistant');
    assert.strictEqual(session.transcript[2].speaker, 'customer'); // Normalized from 'user'
  });

  await t.test('prevents duplicate session leaks on recreation', () => {
    const newSession = sessionManager.createSession({ callId });
    assert.strictEqual(sessionManager.getSessionByCallId(callId), newSession);
    assert.strictEqual(newSession.transcript.length, 0); // Fresh session
  });

  await t.test('removes session cleanly', () => {
    sessionManager.removeSession(callId);
    assert.strictEqual(sessionManager.getSessionByCallId(callId), null);
    assert.strictEqual(sessionManager.getSessionByStreamSid(streamSid), null);
  });
});
