const VoiceSession = require('./VoiceSession');

class SessionManager {
  constructor() {
    this.sessionsByCallId = new Map();
    this.sessionsByStreamSid = new Map();
  }

  getOrCreateSession({ callId, twilioSocket = null }) {
    if (!callId) {
      throw new Error('callId is required to get or create a VoiceSession');
    }

    if (this.sessionsByCallId.has(callId)) {
      const existing = this.sessionsByCallId.get(callId);
      if (twilioSocket) {
        existing.twilioSocket = twilioSocket;
      }
      return existing;
    }

    return this.createSession({ callId, twilioSocket });
  }

  createSession({ callId, twilioSocket = null }) {
    if (!callId) {
      throw new Error('callId is required to create a VoiceSession');
    }

    // Clean up existing session for this callId if present
    if (this.sessionsByCallId.has(callId)) {
      console.log(`[VOICE] Cleaning up previous session for callId: ${callId}`);
      const oldSession = this.sessionsByCallId.get(callId);
      oldSession.cleanup();
      this.removeSession(callId);
    }

    const session = new VoiceSession({ callId, twilioSocket });
    this.sessionsByCallId.set(callId, session);
    console.log(`[VOICE] session created: callId=${callId}`);
    return session;
  }

  getSessionByCallId(callId) {
    if (!callId) return null;
    return this.sessionsByCallId.get(callId) || null;
  }

  getSessionByStreamSid(streamSid) {
    if (!streamSid) return null;
    return this.sessionsByStreamSid.get(streamSid) || null;
  }

  registerStreamSid(callId, streamSid) {
    const session = this.sessionsByCallId.get(callId);
    if (!session) return null;
    session.setTwilioStreamSid(streamSid);
    this.sessionsByStreamSid.set(streamSid, session);
    return session;
  }

  removeSession(callId) {
    const session = this.sessionsByCallId.get(callId);
    if (!session) return null;

    if (session.twilioStreamSid) {
      this.sessionsByStreamSid.delete(session.twilioStreamSid);
    }
    this.sessionsByCallId.delete(callId);
    session.cleanup();
    console.log(`[VOICE] session ended & removed: callId=${callId}`);
    return session;
  }

  cleanupAll() {
    for (const [callId, session] of this.sessionsByCallId.entries()) {
      session.cleanup();
    }
    this.sessionsByCallId.clear();
    this.sessionsByStreamSid.clear();
  }

  getActiveSessionCount() {
    return this.sessionsByCallId.size;
  }
}

// Singleton export
const sessionManager = new SessionManager();
module.exports = sessionManager;
