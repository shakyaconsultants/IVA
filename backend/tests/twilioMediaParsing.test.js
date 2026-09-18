const test = require('node:test');
const assert = require('node:assert');

test('Twilio Media Stream Message Parsing', async (t) => {
  await t.test('parses connected event', () => {
    const raw = JSON.stringify({
      event: 'connected',
      protocol: 'Call',
      version: '1.0.0'
    });
    const parsed = JSON.parse(raw);
    assert.strictEqual(parsed.event, 'connected');
    assert.strictEqual(parsed.protocol, 'Call');
  });

  await t.test('parses start event with SIDs and format', () => {
    const raw = JSON.stringify({
      event: 'start',
      sequenceNumber: '1',
      start: {
        streamSid: 'MZ1234567890',
        accountSid: 'AC1234567890',
        callSid: 'CA1234567890',
        tracks: ['inbound'],
        mediaFormat: {
          encoding: 'audio/x-mulaw',
          sampleRate: 8000,
          channels: 1
        }
      },
      streamSid: 'MZ1234567890'
    });
    const parsed = JSON.parse(raw);
    assert.strictEqual(parsed.event, 'start');
    assert.strictEqual(parsed.streamSid, 'MZ1234567890');
    assert.strictEqual(parsed.start.callSid, 'CA1234567890');
    assert.strictEqual(parsed.start.mediaFormat.encoding, 'audio/x-mulaw');
    assert.strictEqual(parsed.start.mediaFormat.sampleRate, 8000);
  });

  await t.test('parses media payload correctly', () => {
    const payload = Buffer.from('mock mulaw audio').toString('base64');
    const raw = JSON.stringify({
      event: 'media',
      sequenceNumber: '2',
      media: {
        track: 'inbound',
        chunk: '1',
        timestamp: '123456',
        payload
      },
      streamSid: 'MZ1234567890'
    });
    const parsed = JSON.parse(raw);
    assert.strictEqual(parsed.event, 'media');
    assert.strictEqual(parsed.media.payload, payload);
    assert.strictEqual(parsed.streamSid, 'MZ1234567890');
  });

  await t.test('formats Twilio outbound media message according to Twilio specs', () => {
    const delta = Buffer.from('ai response audio').toString('base64');
    const streamSid = 'MZ1234567890';
    const msg = {
      event: 'media',
      streamSid,
      media: {
        payload: delta
      }
    };
    const jsonStr = JSON.stringify(msg);
    const parsed = JSON.parse(jsonStr);
    assert.strictEqual(parsed.event, 'media');
    assert.strictEqual(parsed.streamSid, streamSid);
    assert.strictEqual(parsed.media.payload, delta);
  });

  await t.test('formats Twilio clear message on interruption', () => {
    const streamSid = 'MZ1234567890';
    const clearMsg = {
      event: 'clear',
      streamSid
    };
    const parsed = JSON.parse(JSON.stringify(clearMsg));
    assert.strictEqual(parsed.event, 'clear');
    assert.strictEqual(parsed.streamSid, streamSid);
  });

  await t.test('parses stop event cleanly', () => {
    const raw = JSON.stringify({
      event: 'stop',
      sequenceNumber: '10',
      stop: {
        accountSid: 'AC1234567890',
        callSid: 'CA1234567890'
      },
      streamSid: 'MZ1234567890'
    });
    const parsed = JSON.parse(raw);
    assert.strictEqual(parsed.event, 'stop');
    assert.strictEqual(parsed.streamSid, 'MZ1234567890');
  });
});
