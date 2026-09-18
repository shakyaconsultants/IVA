const EventEmitter = require('events');

/**
 * Base abstract class for Voice AI providers.
 * Decouples telephony from provider-specific protocols.
 */
class VoiceProvider extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = config;
  }

  /**
   * Connect to the voice provider's realtime stream
   */
  async connect() {
    throw new Error('connect() must be implemented by concrete VoiceProvider');
  }

  /**
   * Forward inbound audio from telephony to AI provider
   * @param {string} base64Payload
   */
  sendAudio(base64Payload) {
    throw new Error('sendAudio() must be implemented by concrete VoiceProvider');
  }

  /**
   * Clear AI playback / cancel active response on user barge-in
   */
  clearAudio() {
    throw new Error('clearAudio() must be implemented by concrete VoiceProvider');
  }

  /**
   * Trigger initial AI spoken greeting
   * @param {string} script
   */
  sendGreeting(script) {
    throw new Error('sendGreeting() must be implemented by concrete VoiceProvider');
  }

  /**
   * Return tool output back to the AI session
   * @param {string} toolCallId
   * @param {any} result
   */
  sendToolResult(toolCallId, result) {
    throw new Error('sendToolResult() must be implemented by concrete VoiceProvider');
  }

  /**
   * Terminate connection and clean up listeners
   */
  close() {
    throw new Error('close() must be implemented by concrete VoiceProvider');
  }
}

module.exports = VoiceProvider;
