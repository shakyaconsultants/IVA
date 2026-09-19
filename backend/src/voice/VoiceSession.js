const ALLOWED_TRANSITIONS = {
  CALL_CONNECTED: ['INITIAL_GREETING', 'WAITING_FOR_PROSPECT', 'ENDING', 'ENDED'],
  INITIAL_GREETING: ['AI_SPEAKING', 'WAITING_FOR_PROSPECT', 'PROSPECT_SPEAKING', 'ENDING', 'ENDED'],
  AI_SPEAKING: ['WAITING_FOR_PROSPECT', 'PROSPECT_SPEAKING', 'ENDING', 'ENDED'],
  WAITING_FOR_PROSPECT: ['PROSPECT_SPEAKING', 'ENDING', 'ENDED'],
  PROSPECT_SPEAKING: ['AI_THINKING', 'ENDING', 'ENDED'],
  AI_THINKING: ['AI_SPEAKING', 'ENDING', 'ENDED'],
  ENDING: ['ENDED'],
  ENDED: []
};

const { createInitialQualificationState } = require('./qualificationConstants');

/**
 * VoiceSession represents an in-memory active call bridging Twilio and AI.
 */
class VoiceSession {
  constructor({ callId, twilioSocket = null }) {
    this.callId = callId;
    this.twilioSocket = twilioSocket;
    this.twilioCallSid = null;
    this.twilioStreamSid = null;
    this.aiSessionId = null;
    this.leadId = null;
    this.campaignId = null;
    this.agentPromptId = null;
    this.agentConfigSnapshot = null;
    this.agentConfigVersion = 1;

    this.status = 'initiating'; // 'initiating' | 'active' | 'ended'
    this.aiStatus = 'idle';
    this.startedAt = new Date();
    this.connectedAt = null;
    this.endedAt = null;
    this.durationSec = 0;

    this.hasGreeted = false;
    this.greetingSpokenViaTwiml = false;
    this.pollyVoice = 'Polly.Amy';
    this.isResponding = false;
    this.aiProvider = null;
    this.socketIO = null;

    this.conversationState = 'CALL_CONNECTED';
    this.isEnding = false;
    this.isEnded = false;
    this.setupPromise = null;
    this.isOpenAiReady = false;
    this.pendingEndMark = null;
    this.endCallReason = null;
    this.hasLoggedLatency = false;
    this.timings = { t0: Date.now() };

    this.transcript = [];
    this.qualificationState = createInitialQualificationState();
    this.qualificationAudit = [];

    this.durationInterval = null;
    this._isCleanedUp = false;
  }

  setTwilioStreamSid(streamSid) {
    this.twilioStreamSid = streamSid;
  }

  setTwilioCallSid(callSid) {
    this.twilioCallSid = callSid;
  }

  setSocketIO(io) {
    this.socketIO = io;
  }

  setAiProvider(provider) {
    this.aiProvider = provider;
  }

  startDurationTimer() {
    if (this.durationInterval) return;
    this.connectedAt = new Date();
    this.status = 'active';

    this.durationInterval = setInterval(() => {
      if (this._isCleanedUp || this.status === 'ended') {
        this.stopDurationTimer();
        return;
      }
      this.durationSec = Math.max(0, Math.floor((Date.now() - this.connectedAt.getTime()) / 1000));
      if (this.socketIO) {
        this.socketIO.emit('call:duration', {
          callId: this.callId,
          durationSec: this.durationSec
        });
      }
    }, 1000);
  }

  stopDurationTimer() {
    if (this.durationInterval) {
      clearInterval(this.durationInterval);
      this.durationInterval = null;
    }
  }

  addTranscriptItem({ speaker, text }) {
    if (!text || !text.trim()) return;
    const cleanText = text.trim();
    // Normalize speaker to 'customer' or 'assistant'
    const normalizedSpeaker = (speaker === 'user' || speaker === 'customer') ? 'customer' : 'assistant';
    const item = {
      speaker: normalizedSpeaker,
      text: cleanText,
      timestamp: new Date()
    };
    this.transcript.push(item);

    if (this.socketIO) {
      this.socketIO.emit('transcript:update', {
        callId: this.callId,
        speaker: normalizedSpeaker,
        text: cleanText,
        timestamp: item.timestamp.toISOString()
      });
    }
    return item;
  }

  setAiStatus(newStatus) {
    this.aiStatus = newStatus;
    if (this.socketIO) {
      this.socketIO.emit('call:update', {
        callId: this.callId,
        aiStatus: newStatus
      });
      this.socketIO.emit('ai:status', {
        callId: this.callId,
        status: newStatus
      });
    }
  }

  setConversationState(newState, { allowSilentCompletion = false } = {}) {
    const oldState = this.conversationState;
    if (oldState === newState) return true;

    const allowed = [...(ALLOWED_TRANSITIONS[oldState] || [])];
    if (allowSilentCompletion && oldState === 'AI_THINKING' && newState === 'WAITING_FOR_PROSPECT') {
      allowed.push('WAITING_FOR_PROSPECT');
    }

    if (!allowed.includes(newState)) {
      console.log(`[VOICE STATE] INVALID transition ${oldState} -> ${newState}, ignored`);
      return false;
    }

    this.conversationState = newState;
    console.log(`[VOICE STATE] ${oldState || 'NONE'} -> ${newState}`);
    this.setAiStatus(newState.toLowerCase());
    if (this.socketIO) {
      this.socketIO.emit('ai:state', { callId: this.callId, state: newState });
    }
    return true;
  }

  sendTwilioMark(markName) {
    if (!this.twilioSocket || this.twilioSocket.readyState !== 1 /* OPEN */ || !this.twilioStreamSid) {
      return false;
    }
    const markMsg = {
      event: 'mark',
      streamSid: this.twilioStreamSid,
      mark: {
        name: markName
      }
    };
    try {
      this.twilioSocket.send(JSON.stringify(markMsg));
      return true;
    } catch (err) {
      console.warn(`[VOICE] Failed to send mark ${markName} for callId=${this.callId}: ${err.message}`);
      return false;
    }
  }

  async executeHangup(reason = 'Call completed normally') {
    if (this.isEnded) return;
    this.isEnded = true;
    this.setConversationState('ENDED');
    if (this.aiProvider && typeof this.aiProvider.setEnded === 'function') {
      this.aiProvider.setEnded(true);
    }
    try {
      const twilioService = require('../services/twilioService');
      await twilioService.hangupCall(this.callId, reason);
    } catch (err) {
      console.warn(`[VOICE] hangupCall notice for callId=${this.callId}: ${err.message}`);
    }
  }

  cleanup() {
    if (this._isCleanedUp) return;
    this._isCleanedUp = true;
    this.status = 'ended';
    this.endedAt = new Date();
    this.stopDurationTimer();

    if (this.aiProvider) {
      try {
        this.aiProvider.close();
      } catch (err) {
        // Silently swallow cleanup errors
      }
      this.aiProvider = null;
    }

    if (this.twilioSocket && this.twilioSocket.readyState === 1 /* OPEN */) {
      try {
        this.twilioSocket.close();
      } catch (err) {
        // Silently swallow
      }
    }
    this.twilioSocket = null;
  }
}

module.exports = VoiceSession;
