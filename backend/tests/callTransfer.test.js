const test = require('node:test');
const assert = require('node:assert');
const mongoose = require('mongoose');

const { handleTransferCall } = require('../src/voice/tools/transferCall');
const VoiceSession = require('../src/voice/VoiceSession');
const Call = require('../src/models/Call');
const Lead = require('../src/models/Lead');
const Campaign = require('../src/models/Campaign');
const Transfer = require('../src/models/Transfer');
const CallEvent = require('../src/models/CallEvent');
const twilioService = require('../src/services/twilioService');
const OpenAiRealtimeProvider = require('../src/voice/providers/openaiRealtimeProvider');

test('PSTN Call Transfer Suite', async (t) => {

  // Setup mock session and DB calls
  const mockCallId = 'test_transfer_call_1';
  const mockLeadId = new mongoose.Types.ObjectId();
  const mockCampaignId = new mongoose.Types.ObjectId();

  await t.test('1. successful transfer initiates Twilio transfer, creates records and transitions state', async () => {
    const origFindCall = Call.findOne;
    const origUpdateCall = Call.findOneAndUpdate;
    const origUpdateLead = Lead.findByIdAndUpdate;
    const origUpdateCampaign = Campaign.findByIdAndUpdate;
    const origCreateTransfer = Transfer.create;
    const origCreateEvent = CallEvent.create;
    const origTwilioTransfer = twilioService.transferCall;

    let twilioTransferCalled = false;
    let transferRecordCreated = null;
    let callEventCreated = null;

    Call.findOne = async () => ({
      callId: mockCallId,
      status: 'in-call',
      callerId: '+447479274450',
      transferDestination: '+443300271295',
      leadId: mockLeadId,
      campaignId: mockCampaignId,
      transferred: false
    });

    twilioService.transferCall = async (callId, target, reason) => {
      twilioTransferCalled = true;
      return { success: true, target, providerCallId: 'CA_mock_sid' };
    };

    Transfer.create = async (doc) => {
      transferRecordCreated = doc;
      return doc;
    };

    CallEvent.create = async (event) => {
      callEventCreated = event;
      return event;
    };

    try {
      const session = new VoiceSession({ callId: mockCallId, leadId: mockLeadId });
      session.setConversationState('WAITING_FOR_PROSPECT');
      session.setConversationState('PROSPECT_SPEAKING');
      session.setConversationState('AI_THINKING');

      const result = await handleTransferCall(
        { phone: '+443300271295', reason: 'Qualified IVA prospect with £15,000 debt' },
        session
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.transferred, true);
      assert.strictEqual(result.destination, '+443300271295');
      assert.strictEqual(twilioTransferCalled, true);
      assert.strictEqual(transferRecordCreated.status, 'connected');
      assert.strictEqual(transferRecordCreated.transferDestination, '+443300271295');

      // State machine transition to ENDING
      assert.strictEqual(session.conversationState, 'ENDING');
      assert.strictEqual(session.isEnding, true);
      assert.strictEqual(session.isTransferring, true);
      assert.strictEqual(session.isTransferred, true);
    } finally {
      Call.findOne = origFindCall;
      Call.findOneAndUpdate = origUpdateCall;
      Lead.findByIdAndUpdate = origUpdateLead;
      Campaign.findByIdAndUpdate = origUpdateCampaign;
      Transfer.create = origCreateTransfer;
      CallEvent.create = origCreateEvent;
      twilioService.transferCall = origTwilioTransfer;
    }
  });

  await t.test('2. duplicate transfer prevention avoids double dialing or duplicate records', async () => {
    const origFindCall = Call.findOne;
    const origTwilioTransfer = twilioService.transferCall;
    let twilioCallCount = 0;

    twilioService.transferCall = async () => {
      twilioCallCount++;
      return { success: true };
    };

    try {
      const session = new VoiceSession({ callId: mockCallId });
      session.isTransferring = true; // Already transferring
      session.isTransferred = true;

      const result = await handleTransferCall(
        { phone: '+443300271295', reason: 'Duplicate transfer attempt' },
        session
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(result.transferred, true);
      assert.strictEqual(result.message, 'Transfer already in progress or completed');
      assert.strictEqual(twilioCallCount, 0, 'Must NOT invoke Twilio API again');
    } finally {
      Call.findOne = origFindCall;
      twilioService.transferCall = origTwilioTransfer;
    }
  });

  await t.test('3. transfer failure logs error event and creates failed transfer record without crashing', async () => {
    const origFindCall = Call.findOne;
    const origTwilioTransfer = twilioService.transferCall;
    const origCreateTransfer = Transfer.create;
    const origCreateEvent = CallEvent.create;

    let failedTransferRecord = null;
    let failedEvent = null;

    Call.findOne = async () => ({
      callId: mockCallId,
      status: 'in-call',
      callerId: '+447479274450',
      leadId: mockLeadId
    });

    twilioService.transferCall = async () => {
      throw new Error('Twilio REST API 500: Internal Server Error');
    };

    Transfer.create = async (doc) => {
      failedTransferRecord = doc;
      return doc;
    };

    CallEvent.create = async (event) => {
      failedEvent = event;
      return event;
    };

    try {
      const session = new VoiceSession({ callId: mockCallId });
      session.setConversationState('WAITING_FOR_PROSPECT');
      session.setConversationState('PROSPECT_SPEAKING');
      session.setConversationState('AI_THINKING');

      const result = await handleTransferCall(
        { phone: '+443300271295', reason: 'Failed test' },
        session
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.transferred, false);
      assert.ok(result.error.includes('Twilio REST API 500'));

      // Check failed event and record
      assert.strictEqual(failedEvent.eventType, 'TRANSFER_FAILED');
      assert.strictEqual(failedTransferRecord.status, 'failed');

      // Session reverts isEnding/isTransferring so it can be handled
      assert.strictEqual(session.isTransferring, false);
      assert.strictEqual(session.isEnding, false);
    } finally {
      Call.findOne = origFindCall;
      twilioService.transferCall = origTwilioTransfer;
      Transfer.create = origCreateTransfer;
      CallEvent.create = origCreateEvent;
    }
  });

  await t.test('4. invalid destination number is rejected before Twilio invocation', async () => {
    const origFindCall = Call.findOne;
    const origTwilioTransfer = twilioService.transferCall;
    const origCreateEvent = CallEvent.create;

    let twilioCalled = false;
    let eventCreated = null;

    Call.findOne = async () => ({
      callId: mockCallId,
      status: 'in-call',
      callerId: '+447479274450',
      transferDestination: null
    });

    twilioService.transferCall = async () => {
      twilioCalled = true;
      return {};
    };

    CallEvent.create = async (e) => {
      eventCreated = e;
      return e;
    };

    try {
      const session = new VoiceSession({ callId: mockCallId });
      session.setConversationState('WAITING_FOR_PROSPECT');
      session.setConversationState('PROSPECT_SPEAKING');
      session.setConversationState('AI_THINKING');

      // Invalid phone e.g. "not-a-phone"
      const result = await handleTransferCall(
        { phone: 'not-a-phone', reason: 'Invalid phone test' },
        session
      );

      assert.strictEqual(result.success, false);
      assert.strictEqual(result.transferred, false);
      assert.ok(result.error.includes('Invalid transfer destination phone number'));
      assert.strictEqual(twilioCalled, false, 'Twilio API must NOT be called for invalid number');
      assert.strictEqual(eventCreated.eventType, 'TRANSFER_FAILED');
    } finally {
      Call.findOne = origFindCall;
      twilioService.transferCall = origTwilioTransfer;
      CallEvent.create = origCreateEvent;
    }
  });

  await t.test('5. placeholder destination +442080009999 automatically resolves to DEFAULT_TRANSFER_NUMBER', async () => {
    const origFindCall = Call.findOne;
    const origTwilioTransfer = twilioService.transferCall;
    const origCreateTransfer = Transfer.create;
    let resolvedDestination = null;

    process.env.DEFAULT_TRANSFER_NUMBER = '+443300271295';

    Call.findOne = async () => ({
      callId: mockCallId,
      status: 'in-call',
      callerId: '+447479274450'
    });

    twilioService.transferCall = async (callId, target) => {
      resolvedDestination = target;
      return { success: true, target };
    };

    Transfer.create = async (d) => d;

    try {
      const session = new VoiceSession({ callId: mockCallId });
      session.setConversationState('WAITING_FOR_PROSPECT');
      session.setConversationState('PROSPECT_SPEAKING');
      session.setConversationState('AI_THINKING');

      const result = await handleTransferCall(
        { phone: '+442080009999', reason: 'Placeholder test' },
        session
      );

      assert.strictEqual(result.success, true);
      assert.strictEqual(resolvedDestination, '+443300271295', 'Must replace placeholder +442080009999 with DEFAULT_TRANSFER_NUMBER');
      assert.strictEqual(result.destination, '+443300271295');
    } finally {
      Call.findOne = origFindCall;
      twilioService.transferCall = origTwilioTransfer;
      Transfer.create = origCreateTransfer;
    }
  });

  await t.test('6. no additional AI response is generated after transfer starts', () => {
    const provider = new OpenAiRealtimeProvider({ callId: 'test_no_response_after_transfer' });
    let sentMessages = [];
    provider.isConnected = true;
    provider.ws = {
      readyState: 1,
      send: (msg) => { sentMessages.push(JSON.parse(msg)); }
    };

    // Session starts transfer -> marked ENDING
    provider.setEnding(true);
    assert.strictEqual(provider.isEnding, true);
    assert.strictEqual(provider.conversationState, 'ENDING');

    // Tool result is sent back for transfer_call
    provider.sendToolResult('call_transfer_123', { success: true, transferred: true });

    // conversation.item.create must be sent with function_call_output
    const itemMsg = sentMessages.find(m => m.type === 'conversation.item.create');
    assert.ok(itemMsg);
    assert.strictEqual(itemMsg.item.type, 'function_call_output');

    // response.create must be SUPPRESSED because session is ENDING!
    const responseCreateMsg = sentMessages.find(m => m.type === 'response.create');
    assert.strictEqual(responseCreateMsg, undefined, 'response.create must NOT be sent after transfer starts');
  });

  await t.test('7. transfer-status webhook handles completed and busy outcomes correctly', async () => {
    const webhookRoutes = require('../src/routes/webhookRoutes');

    // Find the transfer-status route layer in router stack
    const transferRoute = webhookRoutes.stack.find(
      (s) => s.route && s.route.path === '/twilio/transfer-status/:callId'
    );
    assert.ok(transferRoute, 'Must define /twilio/transfer-status/:callId route');

    const handler = transferRoute.route.stack[0].handle;

    const origFindCall = Call.findOne;
    const origUpdateCall = Call.findOneAndUpdate;
    const origCreateEvent = CallEvent.create;
    const origUpdateTransfer = Transfer.findOneAndUpdate;

    let updatedCallStatus = null;
    let completedEvent = null;
    let failedEvent = null;

    Call.findOne = async () => ({
      callId: 'call_webhook_test',
      status: 'transferring'
    });

    Call.findOneAndUpdate = async (q, u) => {
      updatedCallStatus = u;
      return u;
    };

    CallEvent.create = async (e) => {
      if (e.eventType === 'TRANSFER_COMPLETED') completedEvent = e;
      if (e.eventType === 'TRANSFER_FAILED') failedEvent = e;
      return e;
    };

    Transfer.findOneAndUpdate = async () => ({});

    try {
      // 1. Specialist answered (DialCallStatus = 'completed')
      let res1Text = '';
      const res1 = {
        type: () => res1,
        send: (text) => { res1Text = text; return res1; }
      };
      await handler(
        { params: { callId: 'call_webhook_test' }, body: { DialCallStatus: 'completed', DialCallDuration: '45', DialCallSid: 'CA_specialist_leg' } },
        res1
      );

      assert.ok(res1Text.includes('<Hangup'));
      assert.ok(completedEvent);
      assert.strictEqual(completedEvent.eventType, 'TRANSFER_COMPLETED');
      assert.strictEqual(updatedCallStatus.status, 'completed');
      assert.strictEqual(updatedCallStatus.disposition, 'Transferred to Specialist');

      // 2. Specialist was busy (DialCallStatus = 'busy')
      let res2Text = '';
      const res2 = {
        type: () => res2,
        send: (text) => { res2Text = text; return res2; }
      };
      await handler(
        { params: { callId: 'call_webhook_test' }, body: { DialCallStatus: 'busy', DialCallDuration: '0' } },
        res2
      );

      assert.ok(res2Text.includes('<Say voice="Polly.Amy">'));
      assert.ok(res2Text.includes('specialist is currently on another consultation'));
      assert.ok(failedEvent);
      assert.strictEqual(failedEvent.eventType, 'TRANSFER_FAILED');
    } finally {
      Call.findOne = origFindCall;
      Call.findOneAndUpdate = origUpdateCall;
      CallEvent.create = origCreateEvent;
      Transfer.findOneAndUpdate = origUpdateTransfer;
    }
  });

});
