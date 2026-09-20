const sessionManager = require('./sessionManager');
const OpenAiRealtimeProvider = require('./providers/openaiRealtimeProvider');
const { TOOL_DEFINITIONS, executeTool } = require('./tools/toolRegistry');
const Call = require('../models/Call');
const Lead = require('../models/Lead');
const AgentPrompt = require('../models/AgentPrompt');
const Settings = require('../models/Settings');
const CallEvent = require('../models/CallEvent');
const { calculateCallCost } = require('../services/billingService');
const { buildRealtimeInstructions, buildOpeningGreeting } = require('./instructionBuilder');

let globalSocketIO = null;

function setSocketIO(io) {
  globalSocketIO = io;
}

/**
 * Prewarm AI session as soon as Twilio requests voice TwiML
 */
async function prewarmAiSession(callId) {
  if (!callId) return null;
  console.log(`[VOICE PREWARM] started for callId=${callId}`);

  const session = sessionManager.getOrCreateSession({ callId });
  if (!session.timings) {
    session.timings = { t0: Date.now() };
  }
  if (!session.conversationState) {
    session.setConversationState('CALL_CONNECTED');
  }

  if (session.aiProvider) {
    return session.aiProvider;
  }
  if (session.setupPromise) {
    return await session.setupPromise;
  }

  session.setupPromise = setupAiProvider(session);
  return await session.setupPromise;
}

/**
 * Handle new Twilio Media Stream connection
 */
function handleTwilioConnection(client, request) {
  const callId = client.callId;
  console.log(`[VOICE] Twilio stream connected: callId=${callId}`);

  const session = sessionManager.getOrCreateSession({ callId, twilioSocket: client });
  if (!session.timings) {
    session.timings = { t0: Date.now() };
  }
  if (!session.conversationState) {
    session.setConversationState('CALL_CONNECTED');
  }
  if (globalSocketIO) {
    session.setSocketIO(globalSocketIO);
  }

  client.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      await handleTwilioEvent(data, session);
    } catch (err) {
      console.warn(`[VOICE] Malformed message from Twilio (callId=${callId}): ${err.message}`);
    }
  });

  client.on('close', async () => {
    console.log(`[VOICE] Twilio stream closed: callId=${callId}`);
    await finalizeAndCleanupSession(callId, 'Twilio stream closed');
  });

  client.on('error', async (err) => {
    console.warn(`[VOICE] Twilio stream error (callId=${callId}): ${err.message}`);
    await finalizeAndCleanupSession(callId, `Twilio stream error: ${err.message}`);
  });
}

/**
 * Dispatch Twilio stream lifecycle events
 */
async function handleTwilioEvent(data, session) {
  const { event } = data;

  switch (event) {
    case 'connected':
      console.log(`[VOICE] Twilio connected event received: callId=${session.callId}`);
      break;

    case 'start':
      await handleTwilioStart(data, session);
      break;

    case 'media':
      handleTwilioMedia(data, session);
      break;

    case 'mark': {
      const markName = data.mark?.name;
      console.log(`[VOICE] Twilio mark event received: name=${markName}, callId=${session.callId}`);

      // T6 measurement: first audio played confirmation on PSTN
      if (markName === 'greeting_mark_initial' && session.timings && !session.timings.t6) {
        session.timings.t6 = Date.now();
        const t0 = session.timings.t0;
        const t5 = session.timings.t5 || t0;
        console.log(`[VOICE LATENCY] T6 greeting played on PSTN: t6=${session.timings.t6}, twilioPlayoutLatency=${session.timings.t6 - t5}ms, totalPSTNLatency=${session.timings.t6 - t0}ms`);
      }

      // Deferred end-call mark: audio has completely finished playing on PSTN
      if (session.pendingEndMark && markName === session.pendingEndMark) {
        console.log(`[VOICE END] Twilio mark received: ${markName}`);
        console.log(`[VOICE END] hanging up callId=${session.callId}`);
        session.pendingEndMark = null;
        session.setConversationState('ENDED');
        await session.executeHangup(session.endCallReason || 'Call completed normally');
        await finalizeAndCleanupSession(session.callId, 'Audio playback completed normally');
      }
      break;
    }

    case 'stop':
      console.log(`[VOICE] Twilio stop event received for callId=${session.callId}`);
      await finalizeAndCleanupSession(session.callId, 'Twilio stop event received');
      break;

    default:
      break;
  }
}

/**
 * Handle Twilio stream start: link SIDs, configure Agent, connect AI
 */
async function handleTwilioStart(data, session) {
  const streamSid = data.streamSid || data.start?.streamSid;
  const callSid = data.start?.callSid;

  session.setTwilioStreamSid(streamSid);
  session.setTwilioCallSid(callSid);
  sessionManager.registerStreamSid(session.callId, streamSid);

  console.log(`[VOICE] audio bridge active: callId=${session.callId}, streamSid=${streamSid}, callSid=${callSid}`);

  // Ensure AI provider is initialized (reusing prewarm promise if in flight)
  if (session.setupPromise && !session.aiProvider) {
    await session.setupPromise;
  } else if (!session.aiProvider) {
    session.setupPromise = setupAiProvider(session);
    await session.setupPromise;
  }

  if (session.isOpenAiReady) {
    console.log(`[VOICE PREWARM] Twilio stream attached to prewarmed session for callId=${session.callId}`);
  } else {
    console.log(`[VOICE PREWARM] Twilio stream attached while OpenAI session still connecting for callId=${session.callId}`);
  }

  // Handle greeting handover:
  if (session.greetingSpokenViaTwiml) {
    if (!session.hasGreeted) {
      session.hasGreeted = true;
      session.setConversationState('WAITING_FOR_PROSPECT');
      session.setAiStatus('listening');

      // Add greeting to transcript exactly once
      if (session.openingScript) {
        session.addTranscriptItem({
          speaker: 'assistant',
          text: session.openingScript
        });
      }

      // Inject spoken greeting into OpenAI conversation context
      if (session.aiProvider && typeof session.aiProvider.injectAssistantMessage === 'function') {
        session.aiProvider.injectAssistantMessage(session.openingScript);
        console.log(`[VOICE] TwiML greeting injected into OpenAI context for callId=${session.callId}`);
      }
    }
  } else {
    // Fallback: If AI session already connected (via prewarming), trigger greeting via OpenAI
    if (session.aiProvider?.isConnected && !session.hasGreeted) {
      session.hasGreeted = true;
      session.setConversationState('INITIAL_GREETING');
      console.log(`[VOICE] triggering initial AI greeting for callId=${session.callId}`);
      session.setAiStatus('speaking');
      session.aiProvider.sendGreeting(session.openingScript);
    }
  }
}

/**
 * Setup and connect OpenAI Realtime provider with prompt configuration
 */
async function setupAiProvider(session) {
  // Parallel database lookups for speed
  const [call, defaultPrompt] = await Promise.all([
    Call.findOne({ callId: session.callId }).lean(),
    AgentPrompt.findOne({ isDefault: true }).lean()
  ]);

  let lead = null;
  let campaign = null;
  let agentPrompt = defaultPrompt;

  if (call?.leadId) {
    lead = await Lead.findById(call.leadId).lean();
    session.leadId = lead?._id;
    session.campaignId = call.campaignId;
  }

  if (call?.campaignId) {
    const Campaign = require('../models/Campaign');
    campaign = await Campaign.findById(call.campaignId).populate('agentId').lean();
    if (campaign?.agentId) {
      agentPrompt = campaign.agentId;
    }
  }

  if (agentPrompt) {
    session.agentPromptId = agentPrompt._id;
    // Snapshot agent configuration onto session for consistent call-time execution
    session.agentConfigSnapshot = JSON.parse(JSON.stringify(agentPrompt));
    session.agentConfigVersion = agentPrompt.version || 1;

    // Persist agent prompt and version to Call record for auditability
    Call.findOneAndUpdate(
      { callId: session.callId },
      { agentPromptId: agentPrompt._id, agentConfigVersion: session.agentConfigVersion }
    ).catch(() => {});
  }

  // Check feature flag
  const isAiEnabled = process.env.VOICE_AI_ENABLED !== 'false';
  const apiKey = process.env.OPENAI_API_KEY;

  if (!isAiEnabled || !apiKey || apiKey.includes('your_openai') || !apiKey.trim()) {
    console.warn(`[VOICE] Realtime AI disabled or missing API key for callId=${session.callId}`);
    session.setAiStatus('error');
    await Call.findOneAndUpdate({ callId: session.callId }, { aiStatus: 'error' });
    return null;
  }

  // Build Layered Realtime Instructions (Platform Rules + Client Instructions + Behaviour + Context)
  const fullInstructions = buildRealtimeInstructions({
    agentConfig: session.agentConfigSnapshot || agentPrompt || {},
    lead: lead || {},
    call: call || {}
  });

  // Format opening greeting script
  session.openingScript = buildOpeningGreeting({
    agentConfig: session.agentConfigSnapshot || agentPrompt || {},
    lead: lead || {}
  });

  // Initialize OpenAI Realtime Provider
  const provider = new OpenAiRealtimeProvider({
    callId: session.callId,
    apiKey,
    model: process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-1.5',
    voice: process.env.OPENAI_REALTIME_VOICE || agentPrompt?.voice || 'alloy',
    instructions: fullInstructions,
    tools: TOOL_DEFINITIONS,
    timings: session.timings
  });

  session.setAiProvider(provider);
  session.setAiStatus('connecting');

  console.log(`[VOICE PREWARM] OpenAI session connecting for callId=${session.callId}`);

  // Wire AI Provider Events -> Twilio & VoiceGateway
  provider.on('connected', async ({ sessionId }) => {
    session.isOpenAiReady = true;
    console.log(`[VOICE PREWARM] OpenAI session ready for callId=${session.callId}`);
    session.aiSessionId = sessionId;
    session.setAiStatus('connected');
    console.log(`[VOICE] AI session ready: callId=${session.callId}, sessionId=${sessionId}`);

    await CallEvent.create({
      callId: session.callId,
      eventType: 'AI_AGENT_CONNECTED',
      payload: { sessionId, model: provider.model }
    }).catch(() => {});

    session.startDurationTimer();

    // Trigger initial greeting if stream is active and not already greeted
    if (session.twilioStreamSid && !session.hasGreeted) {
      if (session.greetingSpokenViaTwiml) {
        session.hasGreeted = true;
        session.setConversationState('WAITING_FOR_PROSPECT');
        session.setAiStatus('listening');

        if (session.openingScript) {
          session.addTranscriptItem({
            speaker: 'assistant',
            text: session.openingScript
          });
        }

        if (typeof provider.injectAssistantMessage === 'function') {
          provider.injectAssistantMessage(session.openingScript);
          console.log(`[VOICE] TwiML greeting injected into OpenAI context for callId=${session.callId}`);
        }
      } else {
        session.hasGreeted = true;
        session.setConversationState('INITIAL_GREETING');
        console.log(`[VOICE] triggering initial AI greeting for callId=${session.callId}`);
        session.setAiStatus('speaking');
        provider.sendGreeting(session.openingScript);
      }
    }
  });

  provider.on('audio', (audioData) => {
    if (session.isEnded || session.conversationState === 'ENDED') {
      return;
    }
    // Forward AI audio to Twilio
    sendTwilioAudio(session, audioData);
  });

  provider.on('state_changed', (state, options) => {
    if (session.isEnded || session.conversationState === 'ENDED') {
      return;
    }
    if (session.isEnding || session.conversationState === 'ENDING') {
      if (state !== 'ENDED') return;
    }
    session.setConversationState(state, options);
  });

  provider.on('response_done', async ({ responseId, silent = false }) => {
    if (session.isEnded || session.conversationState === 'ENDED') {
      return;
    }
    if (session.isEnding || session.conversationState === 'ENDING') {
      console.log(`[VOICE END] final audio sent for callId=${session.callId}`);
      const endMarkName = `end_call_${Date.now()}`;
      session.pendingEndMark = endMarkName;
      console.log(`[VOICE END] waiting for Twilio mark: ${endMarkName}`);
      session.sendTwilioMark(endMarkName);
    } else if (session.conversationState === 'AI_SPEAKING' || session.conversationState === 'INITIAL_GREETING') {
      session.setConversationState('WAITING_FOR_PROSPECT');
    } else if (silent && session.conversationState === 'AI_THINKING') {
      session.setConversationState('WAITING_FOR_PROSPECT', { allowSilentCompletion: true });
    }
  });

  provider.on('greeting_interrupted', () => {
    if (session.isEnded || session.conversationState === 'ENDED') return;
    console.log(`[VOICE] initial greeting interrupted by prospect for callId=${session.callId}`);
    sendTwilioClear(session);
    session.setAiStatus('interrupted');
  });

  provider.on('speech_started', (eventData) => {
    if (session.isEnded || session.isEnding || session.conversationState === 'ENDING' || session.conversationState === 'ENDED') {
      return;
    }
    // Genuine interruption: flush Twilio audio buffer immediately if AI is speaking (including initial greeting)
    if (session.conversationState === 'AI_SPEAKING' || session.conversationState === 'INITIAL_GREETING') {
      console.log(`[VOICE BARGE-IN] genuine barge-in detected during ${session.conversationState}: clearing Twilio for callId=${session.callId}`);
      sendTwilioClear(session);
      session.setConversationState('PROSPECT_SPEAKING');
    } else if (session.conversationState === 'WAITING_FOR_PROSPECT') {
      console.log(`[VOICE] prospect speech started from WAITING_FOR_PROSPECT for callId=${session.callId}`);
      session.setConversationState('PROSPECT_SPEAKING');
    } else {
      console.log(`[VOICE] speech_started ignored in voiceGateway because state is ${session.conversationState}`);
    }
  });

  provider.on('speech_stopped', () => {
    if (session.isEnded || session.isEnding || session.conversationState === 'ENDING' || session.conversationState === 'ENDED') {
      return;
    }
    if (session.conversationState === 'PROSPECT_SPEAKING') {
      session.setConversationState('AI_THINKING');
    }
  });

  provider.on('status', async (aiStatus) => {
    if (session.isEnded || session.conversationState === 'ENDED') return;
    session.setAiStatus(aiStatus);
    await Call.findOneAndUpdate({ callId: session.callId }, { aiStatus }).catch(() => {});
  });

  provider.on('transcript', ({ speaker, text }) => {
    if (session.isEnded || session.conversationState === 'ENDED') return;
    session.addTranscriptItem({ speaker, text });
  });

  provider.on('tool_call', async ({ toolCallId, name, arguments: args }) => {
    if (session.isEnded || session.conversationState === 'ENDED') {
      console.log(`[VOICE] tool_call ${name} ignored because session is ENDED`);
      return;
    }
    console.log(`[VOICE] executing tool ${name} for callId=${session.callId}`);
    session.setAiStatus('thinking');
    const result = await executeTool(name, args, session);
    provider.sendToolResult(toolCallId, result);
  });

  provider.on('error', (err) => {
    if (session.isEnded || session.conversationState === 'ENDED') return;
    session.setAiStatus('error');
    console.error(`[VOICE] Provider error on callId=${session.callId}: ${err.message}`);
  });

  try {
    await provider.connect();
    return provider;
  } catch (err) {
    console.error(`[VOICE] Failed to connect AI provider for callId=${session.callId}: ${err.message}`);
    session.setAiStatus('error');
    await Call.findOneAndUpdate({ callId: session.callId }, { aiStatus: 'error' }).catch(() => {});
    return null;
  }
}

/**
 * Forward inbound customer audio from Twilio to OpenAI
 */
function handleTwilioMedia(data, session) {
  if (session.isEnded || session.isEnding || session.conversationState === 'ENDING' || session.conversationState === 'ENDED') {
    return;
  }
  const payload = data.media?.payload;
  if (!payload || !session.aiProvider) return;
  session.aiProvider.sendAudio(payload);
}

/**
 * Send AI synthesized audio to Twilio Media Stream
 */
function sendTwilioAudio(session, audioData) {
  if (session.isEnded || session.conversationState === 'ENDED') {
    return false;
  }
  const base64Payload = typeof audioData === 'string' ? audioData : audioData?.delta;
  const eventType = typeof audioData === 'string' ? 'response.output_audio.delta' : (audioData?.eventType || 'response.output_audio.delta');

  if (!base64Payload || typeof base64Payload !== 'string') {
    return false;
  }

  const decodedBuf = Buffer.from(base64Payload, 'base64');
  const byteLength = decodedBuf.length;

  // Single-chunk diagnostic logging for byte/codec verification
  if (!session.hasLoggedCodecDebug) {
    session.hasLoggedCodecDebug = true;
    const first16Hex = decodedBuf.subarray(0, 16).toString('hex');
    const last16Hex = decodedBuf.subarray(Math.max(0, decodedBuf.length - 16)).toString('hex');
    console.log(`[VOICE CODEC DEBUG]
event=${eventType}
format=audio/pcmu
base64Length=${base64Payload.length}
decodedBytes=${byteLength}
first16Hex=${first16Hex}
last16Hex=${last16Hex}
streamSid=${session.twilioStreamSid || 'none'}`);
  }

  if (!session.twilioSocket || session.twilioSocket.readyState !== 1 /* OPEN */) {
    console.log(`[VOICE AUDIO] OpenAI delta: type=${eventType}, bytes=${byteLength}, streamSid=${session.twilioStreamSid || 'none'}, forwarded=false (socket not open)`);
    return false;
  }
  if (!session.twilioStreamSid) {
    console.log(`[VOICE AUDIO] OpenAI delta: type=${eventType}, bytes=${byteLength}, streamSid=none, forwarded=false (missing streamSid)`);
    return false;
  }

  // Exact Twilio Media Streams format
  const twilioMediaMessage = {
    event: 'media',
    streamSid: session.twilioStreamSid,
    media: {
      payload: base64Payload
    }
  };

  try {
    session.twilioSocket.send(JSON.stringify(twilioMediaMessage));
    session.hasBufferedAudio = true;
    session.lastAudioSentAt = Date.now();

    // Record T5 and log startup latency once for initial greeting
    if (session.timings && !session.timings.t5 && session.timings.t0) {
      session.timings.t5 = Date.now();
      if (!session.hasSentInitialMark && typeof session.sendTwilioMark === 'function') {
        session.hasSentInitialMark = true;
        session.sendTwilioMark('greeting_mark_initial');
      }
    }
    if (!session.hasLoggedLatency && session.timings?.t0) {
      session.hasLoggedLatency = true;
      const t = session.timings;
      const t0 = t.t0;
      const t1 = t.t1 || t0;
      const t2 = t.t2 || t1;
      const t3 = t.t3 || t2;
      const t4 = t.t4 || t3;
      const t5 = t.t5 || t4;

      console.log(`[VOICE LATENCY]
streamConnectedMs=0
openAIConnectedMs=${t1 - t0}
sessionUpdatedMs=${t2 - t0}
greetingRequestedMs=${t3 - t0}
firstAudioDeltaMs=${t4 - t0}
firstAudioForwardedMs=${t5 - t0}
openAIConnectLatency=${t1 - t0}ms
sessionUpdateLatency=${t2 - t1}ms
greetingGenerationLatency=${t4 - t3}ms
firstAudioForwardLatency=${t5 - t4}ms
totalTimeToFirstAudio=${t5 - t0}ms`);
    }

    console.log(`[VOICE AUDIO] OpenAI delta: type=${eventType}, bytes=${byteLength}, streamSid=${session.twilioStreamSid}, forwarded=true`);
    console.log(`[VOICE AUDIO] Twilio outbound: event=media, streamSid=${session.twilioStreamSid}, bytes=${byteLength}`);
    return true;
  } catch (err) {
    console.warn(`[VOICE AUDIO] Error sending audio to Twilio: ${err.message}`);
    console.log(`[VOICE AUDIO] OpenAI delta: type=${eventType}, bytes=${byteLength}, streamSid=${session.twilioStreamSid}, forwarded=false`);
    return false;
  }
}

/**
 * Send clear message to Twilio to flush pending audio on customer barge-in
 */
function sendTwilioClear(session) {
  if (!session.twilioSocket || session.twilioSocket.readyState !== 1 /* OPEN */) {
    return false;
  }
  if (!session.twilioStreamSid) {
    return false;
  }

  const clearMessage = {
    event: 'clear',
    streamSid: session.twilioStreamSid
  };

  try {
    session.twilioSocket.send(JSON.stringify(clearMessage));
    session.hasBufferedAudio = false;
    console.log(`[VOICE] sent clear message to Twilio streamSid=${session.twilioStreamSid}`);
    return true;
  } catch (err) {
    console.warn(`[VOICE] Error sending clear to Twilio: ${err.message}`);
    return false;
  }
}

/**
 * Finalize call state in database, persist transcript, clean up in-memory session
 */
async function finalizeAndCleanupSession(callId, reason = 'Normal Clearing') {
  const session = sessionManager.getSessionByCallId(callId);
  if (!session) return;

  console.log(`[VOICE] finalizing session for callId=${callId}: ${reason}`);
  session.stopDurationTimer();
  session.setAiStatus('ended');

  try {
    const call = await Call.findOne({ callId });
    if (call) {
      const endedAt = new Date();
      const durationSec = session.durationSec || (call.answeredAt ? Math.max(1, Math.floor((endedAt - call.answeredAt) / 1000)) : 0);
      const settings = await Settings.findOne({ key: 'global_config' });
      const cost = calculateCallCost(durationSec, settings);

      // Persist transcript array
      const finalTranscript = session.transcript.map((t) => ({
        speaker: t.speaker === 'customer' ? 'user' : 'ai',
        text: t.text,
        timestamp: t.timestamp
      }));

      const finalStatus = call.status === 'transferring' ? 'transferred' : (call.status === 'in-call' ? 'completed' : call.status);

      await Call.findOneAndUpdate(
        { callId },
        {
          status: finalStatus,
          aiStatus: 'ended',
          endedAt,
          durationSec,
          cost,
          transcript: finalTranscript.length > 0 ? finalTranscript : call.transcript
        }
      );

      if (globalSocketIO) {
        globalSocketIO.emit('call:ended', {
          callId,
          status: finalStatus,
          durationSec,
          disposition: call.disposition
        });
      }
    }
  } catch (err) {
    console.error(`[VOICE] Error persisting final call state for callId=${callId}: ${err.message}`);
  } finally {
    sessionManager.removeSession(callId);
  }
}

module.exports = {
  handleTwilioConnection,
  handleTwilioEvent,
  finalizeAndCleanupSession,
  setSocketIO,
  sendTwilioAudio,
  sendTwilioClear,
  prewarmAiSession
};
