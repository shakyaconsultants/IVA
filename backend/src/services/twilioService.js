const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const Call = require('../models/Call');
const CallEvent = require('../models/CallEvent');
const Lead = require('../models/Lead');
const Campaign = require('../models/Campaign');
const Settings = require('../models/Settings');
const { calculateCallCost } = require('./billingService');

let socketIO = null;

function setSocketIO(io) {
  socketIO = io;
}

function emitCallUpdate(update) {
  if (socketIO) socketIO.emit('call:update', update);
}

async function getConfiguration() {
  const baseUrl = process.env.PUBLIC_BASE_URL;

  return {
     accountSid: process.env.TWILIO_ACCOUNT_SID,
     authToken: process.env.TWILIO_AUTH_TOKEN,
     callerId: process.env.TWILIO_CALLER_ID,
     transferNumber: process.env.DEFAULT_TRANSFER_NUMBER,
    baseUrl: baseUrl ? baseUrl.replace(/\/$/, '') : ''
  };
}

function twimlUrl(baseUrl, callId) {
  return `${baseUrl}/api/webhooks/twilio/voice/${encodeURIComponent(callId)}`;
}

async function originateCall({ lead, campaign, callerId }) {
  const config = await getConfiguration();
  if (!config.accountSid || !config.authToken || !config.callerId) {
    throw new Error('Twilio Account SID, Auth Token, and Caller ID are required');
  }
  if (!/^https:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(config.baseUrl || '')) {
    throw new Error('PUBLIC_BASE_URL must be a public HTTPS URL for Twilio webhooks');
  }

  const callId = `twilio_${Date.now()}_${uuidv4().substring(0, 8)}`;
  const fromNumber = config.callerId;
  const transferNumber = config.transferNumber;
  const call = await Call.create({
    callId,
    leadId: lead._id,
    campaignId: campaign?._id,
    leadPhone: lead.phone,
    callerId: fromNumber,
    status: 'initiated',
    aiStatus: 'idle',
    amdStatus: 'pending',
    transferDestination: transferNumber
  });

  await Lead.findByIdAndUpdate(lead._id, {
    status: 'dialing',
    lastCallAt: new Date(),
    lastCallId: call._id,
    $inc: { attempts: 1 }
  });
  if (campaign?._id) {
    await Campaign.findByIdAndUpdate(campaign._id, { $inc: { dialedLeads: 1 } });
  }
  await CallEvent.create({
    callId,
    eventType: 'DIAL_INITIATED',
    payload: { phone: lead.phone, callerId: fromNumber, provider: 'twilio' }
  });

  const response = await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Calls.json`,
    new URLSearchParams({
      To: lead.phone,
      From: fromNumber,
      Url: twimlUrl(config.baseUrl, callId),
      StatusCallback: `${config.baseUrl}/api/webhooks/twilio/status`,
      StatusCallbackMethod: 'POST',
      StatusCallbackEvent: 'initiated ringing answered completed',
      MachineDetection: 'Enable',
      MachineDetectionTimeout: '5'
    }),
    { auth: { username: config.accountSid, password: config.authToken } }
  );

  await Call.findOneAndUpdate({ callId }, { providerCallId: response.data.sid });
  if (socketIO) socketIO.emit('call:new', call);
  return { success: true, callId, providerCallId: response.data.sid };
}

async function transferCall(callId, destinationNumber, reason = 'Qualified IVA prospect') {
  const config = await getConfiguration();
  const call = await Call.findOne({ callId });
  if (!call?.providerCallId) throw new Error('Twilio call not found');
  const target = destinationNumber || call.transferDestination || config.transferNumber;
  const response = await axios.post(
    `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Calls/${call.providerCallId}.json`,
    new URLSearchParams({ Twiml: `<Response><Dial>${target}</Dial></Response>` }),
    { auth: { username: config.accountSid, password: config.authToken } }
  );
  await Call.findOneAndUpdate({ callId }, {
    status: 'transferring', aiStatus: 'transferring', transferDestination: target,
    transferred: true, disposition: 'Transferred to Specialist'
  });
  await Lead.findByIdAndUpdate(call.leadId, { status: 'transferred', transferred: true, interested: true, disposition: 'Transferred to Specialist' });
  if (call.campaignId) await Campaign.findByIdAndUpdate(call.campaignId, { $inc: { transferredCalls: 1, interestedLeads: 1 } });
  await CallEvent.create({ callId, eventType: 'TRANSFER_REQUESTED', payload: { target, reason, provider: 'twilio' } });
  return { success: true, target, providerCallId: response.data.sid };
}

async function hangupCall(callId, reason = 'Normal Clearing') {
  const config = await getConfiguration();
  const call = await Call.findOne({ callId });
  if (call?.providerCallId) {
    await axios.post(
      `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Calls/${call.providerCallId}.json`,
      new URLSearchParams({ Status: 'completed' }),
      { auth: { username: config.accountSid, password: config.authToken } }
    );
  }
  return finalizeCall(callId, 'completed', reason);
}

async function finalizeCall(callId, status, reason) {
  const call = await Call.findOne({ callId });
  if (!call) return null;
  const endedAt = new Date();
  const durationSec = call.answeredAt ? Math.max(1, Math.floor((endedAt - call.answeredAt) / 1000)) : 0;
  const settings = await Settings.findOne({ key: 'global_config' });
  const updatedCall = await Call.findOneAndUpdate({ callId }, {
    status, aiStatus: 'ended', endedAt, durationSec,
    cost: calculateCallCost(durationSec, settings),
    notes: call.notes ? `${call.notes} | ${reason}` : reason
  }, { new: true });
  await Lead.findByIdAndUpdate(call.leadId, { status: status === 'transferred' ? 'transferred' : 'completed', disposition: updatedCall.disposition || 'Completed' });
  await CallEvent.create({ callId, eventType: 'CALL_ENDED', payload: { reason, durationSec, provider: 'twilio' } });
  if (socketIO) socketIO.emit('call:ended', { callId, status, durationSec, disposition: updatedCall.disposition });
  return updatedCall;
}

module.exports = { originateCall, transferCall, hangupCall, finalizeCall, setSocketIO, emitCallUpdate };