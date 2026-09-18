const WebSocket = require('ws');
const VoiceProvider = require('./VoiceProvider');

class OpenAiRealtimeProvider extends VoiceProvider {
  constructor(config = {}) {
    super(config);

    this.apiKey = config.apiKey || process.env.OPENAI_API_KEY;
    this.model = config.model || process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-1.5';
    this.voice = config.voice || process.env.OPENAI_REALTIME_VOICE || 'alloy';
    this.instructions = config.instructions || '';
    this.tools = config.tools || [];
    this.callId = config.callId || 'unknown';

    this.ws = null;
    this.isConnected = false;
    this.isResponding = false;
    this.activeResponse = false;
    this.activeResponseId = null;
    this.currentResponseId = null;
    this.cancelledResponseIds = new Set();
    this._cancellationInProgress = false;
    this._closing = false;
    this._sessionConfigured = false;
    this.timings = config.timings || { t0: Date.now() };
    this.conversationState = 'CALL_CONNECTED';
    this.isEnding = false;
    this.isEnded = false;
    this.isInitialGreeting = false;
    this._initialGreetingSpeechTimer = null;
  }

  setEnding(isEnding = true) {
    this.isEnding = isEnding;
    if (isEnding) {
      this.conversationState = 'ENDING';
    }
  }

  setEnded(isEnded = true) {
    this.isEnded = isEnded;
    if (isEnded) {
      this.conversationState = 'ENDED';
      this.close();
    }
  }

  async connect() {
    if (!this.apiKey || this.apiKey.includes('your_openai') || !this.apiKey.trim()) {
      throw new Error('OPENAI_API_KEY is not configured or invalid');
    }

    return new Promise((resolve, reject) => {
      const url = `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(this.model)}`;
      console.log(`[VOICE] AI session connecting (GA /v1/realtime): model=${this.model}, callId=${this.callId}`);

      // GA API handshake uses Bearer authentication without the deprecated 'OpenAI-Beta' header
      const headers = {
        Authorization: `Bearer ${this.apiKey}`
      };

      try {
        this.ws = new WebSocket(url, { headers });
      } catch (err) {
        return reject(err);
      }

      const connectionTimeout = setTimeout(() => {
        if (!this.isConnected) {
          this.close();
          reject(new Error(`OpenAI Realtime connection timed out after 10s for callId=${this.callId}`));
        }
      }, 10000);

      this.ws.on('open', () => {
        clearTimeout(connectionTimeout);
        this.isConnected = true;
        this.timings.t1 = Date.now();
        console.log(`[VOICE] AI session connected (GA /v1/realtime): callId=${this.callId}`);

        // Configure session using GA schema with nested audio specifications
        this._configureSession();
        resolve(this);
      });

      this.ws.on('message', (data) => {
        this._handleServerEvent(data);
      });

      this.ws.on('error', (err) => {
        clearTimeout(connectionTimeout);
        console.error(`[VOICE] OpenAI WebSocket error for callId=${this.callId}: ${err.message}`);
        this.emit('error', err);
        if (!this.isConnected) {
          reject(err);
        }
      });

      this.ws.on('close', (code, reason) => {
        clearTimeout(connectionTimeout);
        this.isConnected = false;
        if (this._initialGreetingSpeechTimer) {
          clearTimeout(this._initialGreetingSpeechTimer);
          this._initialGreetingSpeechTimer = null;
        }
        console.log(`[VOICE] OpenAI WebSocket closed for callId=${this.callId} (code: ${code}, reason: ${reason.toString() || 'none'})`);
        this.emit('closed', { code, reason });
      });
    });
  }

  _configureSession() {
    // GA Schema:
    // - session.type: 'realtime'
    // - session.output_modalities: ['audio']
    // - audio.output.voice: this.voice (NOT session.voice)
    // - audio.output.format: { type: 'audio/pcmu' }
    // - audio.input.format: { type: 'audio/pcmu' }
    // - audio.input.transcription: { model: 'whisper-1' }
    // - audio.input.turn_detection: { type: 'server_vad' }
    const sessionUpdateEvent = {
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions: this.instructions,
        output_modalities: ['audio'],
        audio: {
          input: {
            format: { type: 'audio/pcmu' },
            transcription: {
              model: 'whisper-1'
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500
            }
          },
          output: {
            format: { type: 'audio/pcmu' },
            voice: this.voice
          }
        },
        tools: this.tools,
        tool_choice: 'auto'
      }
    };

    console.log(`[VOICE] sending GA session.update for callId=${this.callId} (audio/pcmu, voice=${this.voice}, output_modalities=["audio"])`);
    this._send(sessionUpdateEvent);
  }

  _handleServerEvent(rawMessage) {
    if (this.isEnded || this.conversationState === 'ENDED') {
      return;
    }

    try {
      const event = JSON.parse(rawMessage.toString());

      switch (event.type) {
        case 'session.created':
          console.log(`[VOICE] OpenAI session.created: sessionId=${event.session?.id}`);
          break;

        case 'session.updated':
          this._sessionConfigured = true;
          this.timings.t2 = Date.now();
          const confirmedOutputFormat = event.session?.audio?.output?.format?.type || event.session?.audio?.output?.format || 'audio/pcmu';
          const confirmedVoice = event.session?.audio?.output?.voice || event.session?.voice || this.voice;
          console.log(`[VOICE] OpenAI session.updated confirmed (GA config applied): sessionId=${event.session?.id}, outputFormat=${confirmedOutputFormat}, voice=${confirmedVoice}`);
          this.emit('connected', { sessionId: event.session?.id });
          break;

        case 'response.created': {
          if (this.isEnded || this.conversationState === 'ENDED') {
            console.log(`[VOICE RESPONSE] ignoring response.created because session is ENDED`);
            break;
          }
          if (this.isEnding || this.conversationState === 'ENDING') {
            console.log(`[VOICE RESPONSE] ignoring new response.created because session is ENDING`);
            break;
          }
          this.isResponding = true;
          this.activeResponse = true;
          this.currentResponseId = event.response?.id || null;
          this.activeResponseId = event.response?.id || null;
          this._cancellationInProgress = false;
          console.log(`[VOICE RESPONSE] responseId=${this.currentResponseId} started`);
          this.emit('response_created', { responseId: this.currentResponseId });
          this.emit('status', 'thinking');
          if (this.isInitialGreeting) {
            this.conversationState = 'INITIAL_GREETING';
          } else {
            this.conversationState = 'AI_THINKING';
          }
          this.emit('state_changed', this.conversationState);
          break;
        }

        // GA: response.output_audio.delta | Legacy fallback: response.audio.delta
        case 'response.output_audio.delta':
        case 'response.audio.delta': {
          if (this.isEnded || this.conversationState === 'ENDED') {
            break;
          }
          const deltaResponseId = event.response_id || this.currentResponseId;
          // Task C & Bug 4: Discard late audio deltas belonging to a cancelled response or when cancellation in progress
          if (
            (deltaResponseId && this.cancelledResponseIds.has(deltaResponseId)) ||
            (this.currentResponseId && deltaResponseId !== this.currentResponseId) ||
            this._cancellationInProgress
          ) {
            console.log(`[VOICE BARGE-IN] ignoring stale audio responseId=${deltaResponseId || 'unknown'}`);
            break;
          }

          if (event.delta) {
            if (!this.timings.t4) {
              this.timings.t4 = Date.now();
            }
            this.isResponding = true;
            this.activeResponse = true;
            this.emit('status', 'speaking');
            if (this.conversationState !== 'ENDING') {
              this.conversationState = this.isInitialGreeting ? 'INITIAL_GREETING' : 'AI_SPEAKING';
              this.emit('state_changed', this.conversationState);
            }
            this.emit('audio', {
              delta: event.delta,
              eventType: event.type,
              responseId: deltaResponseId
            });
          }
          break;
        }

        // Output audio stream completed for this item
        case 'response.output_audio.done':
        case 'response.audio.done':
          this.isResponding = false;
          this.emit('status', 'listening');
          break;

        // Response fully concluded or cancelled
        case 'response.done': {
          const doneId = event.response?.id || this.currentResponseId;
          this.isResponding = false;
          this.activeResponse = false;
          this._cancellationInProgress = false;

          if (this._initialGreetingSpeechTimer) {
            clearTimeout(this._initialGreetingSpeechTimer);
            this._initialGreetingSpeechTimer = null;
          }

          // Bug 4: Cancelled or stale response must not change conversation state
          if (doneId && this.cancelledResponseIds.has(doneId)) {
            console.log(`[VOICE BARGE-IN] ignoring stale response lifecycle responseId=${doneId}`);
            break;
          }
          if (this.currentResponseId && doneId && doneId !== this.currentResponseId) {
            console.log(`[VOICE BARGE-IN] ignoring stale response lifecycle responseId=${doneId}`);
            break;
          }

          console.log(`[VOICE RESPONSE] responseId=${doneId} completed`);
          this.emit('response_done', { responseId: doneId });

          if (this.isInitialGreeting) {
            this.isInitialGreeting = false;
            console.log(`[VOICE] initial greeting completed; transitioning to WAITING_FOR_PROSPECT for callId=${this.callId}`);
          }

          // Bug 1 & 5: AI_SPEAKING -> WAITING_FOR_PROSPECT only when NOT ending or ended
          if (!this.isEnding && !this.isEnded && this.conversationState !== 'ENDING' && this.conversationState !== 'ENDED') {
            this.conversationState = 'WAITING_FOR_PROSPECT';
            this.emit('state_changed', this.conversationState);
          }
          break;
        }

        case 'response.cancelled': {
          const cancelId = event.response?.id || this.currentResponseId;
          this.isResponding = false;
          this.activeResponse = false;
          this._cancellationInProgress = false;
          if (cancelId) {
            this.cancelledResponseIds.add(cancelId);
          }
          console.log(`[VOICE RESPONSE] responseId=${cancelId} cancelled`);
          this.emit('response_cancelled', { responseId: cancelId });
          break;
        }

        case 'input_audio_buffer.speech_started': {
          if (this.isEnding || this.isEnded || this.conversationState === 'ENDING' || this.conversationState === 'ENDED') {
            console.log(`[VOICE] ignoring speech_started because session is ${this.conversationState}`);
            break;
          }
          console.log(`[VOICE] speech started (user turn detected) for callId=${this.callId}`);
          const wasActive = this.activeResponse || this.isResponding;
          this.conversationState = 'PROSPECT_SPEAKING';
          this.emit('state_changed', this.conversationState);
          this.emit('speech_started', { wasResponding: wasActive, isInitialGreeting: this.isInitialGreeting });

          if (this.isInitialGreeting) {
            // Task 4: Protect initial greeting from false barge-in
            // Do not immediately cancel on transient speech/noise (e.g. line click / quick hello)
            // Only interrupt if speech is sustained (genuine interruption)
            if (!this._initialGreetingSpeechTimer && this.activeResponse && !this._cancellationInProgress) {
              this._initialGreetingSpeechTimer = setTimeout(() => {
                this._initialGreetingSpeechTimer = null;
                if (this.isInitialGreeting && this.activeResponse && !this._cancellationInProgress) {
                  console.log(`[VOICE] sustained prospect interruption confirmed during initial greeting for callId=${this.callId}`);
                  this.isInitialGreeting = false;
                  this.clearAudio();
                  this.emit('greeting_interrupted');
                }
              }, 800);
            }
          } else {
            // Normal conversation turn: prompt barge-in
            if (this.activeResponse && !this._cancellationInProgress) {
              this.clearAudio();
            }
          }
          break;
        }

        case 'input_audio_buffer.speech_stopped': {
          if (this.isEnding || this.isEnded || this.conversationState === 'ENDING' || this.conversationState === 'ENDED') {
            break;
          }
          console.log(`[VOICE] speech stopped for callId=${this.callId}`);
          if (this.isInitialGreeting && this._initialGreetingSpeechTimer) {
            // Transient speech or click ended quickly (<800ms) - preserve greeting
            console.log(`[VOICE] transient speech ended (<800ms) during initial greeting; preserving greeting for callId=${this.callId}`);
            clearTimeout(this._initialGreetingSpeechTimer);
            this._initialGreetingSpeechTimer = null;
          }
          if (!this.isInitialGreeting && !this.activeResponse && this.conversationState === 'PROSPECT_SPEAKING') {
            this.conversationState = 'AI_THINKING';
            this.emit('state_changed', this.conversationState);
          }
          this.emit('speech_stopped');
          break;
        }

        case 'conversation.item.input_audio_transcription.completed':
          if (event.transcript && event.transcript.trim()) {
            console.log(`[VOICE] customer transcript received: "${event.transcript.trim()}"`);
            this.emit('transcript', {
              speaker: 'customer',
              text: event.transcript.trim()
            });
          }
          break;

        // GA: response.output_audio_transcript.done | Legacy fallback: response.audio_transcript.done
        case 'response.output_audio_transcript.done':
        case 'response.audio_transcript.done':
          if (event.transcript && event.transcript.trim()) {
            console.log(`[VOICE] AI transcript received: "${event.transcript.trim()}"`);
            this.emit('transcript', {
              speaker: 'assistant',
              text: event.transcript.trim()
            });
          }
          break;

        case 'response.function_call_arguments.done':
          console.log(`[VOICE] tool call received from AI: ${event.name}`);
          let parsedArgs = {};
          try {
            parsedArgs = JSON.parse(event.arguments || '{}');
          } catch (e) {
            console.warn(`[VOICE] Failed to parse function args: ${event.arguments}`);
          }
          this.emit('tool_call', {
            toolCallId: event.call_id,
            name: event.name,
            arguments: parsedArgs
          });
          break;

        case 'error': {
          const errMsg = event.error?.message || (typeof event.error === 'string' ? event.error : '');
          const isCancellationNotice = errMsg.toLowerCase().includes('cancellation failed') || 
                                       errMsg.toLowerCase().includes('no active response');
          if (isCancellationNotice) {
            // Benign race condition: cancellation requested right as response was already completed/cleared
            console.log(`[VOICE] Notice (benign cancellation race) for callId=${this.callId}: ${errMsg}`);
            this.activeResponse = false;
            this.activeResponseId = null;
            this.isResponding = false;
            this._cancellationInProgress = false;
            break;
          }

          // Genuine OpenAI API error
          console.error(`[VOICE] OpenAI Realtime API error for callId=${this.callId}:`, errMsg || event.error);
          this.emit('error', new Error(errMsg || 'OpenAI Realtime Error'));
          break;
        }

        default:
          // Ignore unhandled lifecycle deltas safely
          break;
      }
    } catch (err) {
      console.warn(`[VOICE] Error processing OpenAI message: ${err.message}`);
    }
  }

  sendAudio(base64Payload) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return false;
    }
    if (this.isEnding || this.isEnded || this.conversationState === 'ENDING' || this.conversationState === 'ENDED') {
      return false;
    }

    this._send({
      type: 'input_audio_buffer.append',
      audio: base64Payload
    });
    return true;
  }

  clearAudio() {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    try {
      // Only cancel when an active response actually exists and cancellation is not already underway
      if (this.activeResponse && !this._cancellationInProgress) {
        this._cancellationInProgress = true;
        const targetId = this.currentResponseId || this.activeResponseId;
        if (targetId) {
          this.cancelledResponseIds.add(targetId);
          console.log(`[VOICE BARGE-IN] cancelling responseId=${targetId}`);
        }
        this._send({ type: 'response.cancel' });
      }
    } catch (err) {
      // Ignore send failures
    } finally {
      this.activeResponse = false;
      this.activeResponseId = null;
      this.currentResponseId = null;
      this.isResponding = false;
    }
  }

  sendGreeting(script) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    if (this.isEnding || this.isEnded || this.conversationState === 'ENDING' || this.conversationState === 'ENDED') {
      console.log(`[VOICE] blocked sendGreeting because session is ${this.conversationState}`);
      return;
    }

    this.timings.t3 = Date.now();
    this.isInitialGreeting = true;
    this.conversationState = 'INITIAL_GREETING';
    this.emit('state_changed', this.conversationState);

    const openingText = script && script.trim()
      ? script.trim()
      : 'Hello! This is Sarah calling regarding your UK debt relief assessment. How are you today?';

    const greetingInstructions = `Start the call immediately. Do not wait for the prospect to speak. Deliver the opening greeting naturally, then stop and wait for the prospect.\n\nOpening greeting to speak:\n"${openingText}"`;

    console.log(`[VOICE] triggering initial greeting response.create for callId=${this.callId} (T3=${this.timings.t3})`);
    this._send({
      type: 'response.create',
      response: {
        instructions: greetingInstructions
      }
    });
  }

  sendToolResult(toolCallId, result) {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    // 1. Send tool output
    this._send({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: toolCallId,
        output: JSON.stringify(result)
      }
    });

    // 2. Only trigger follow-up response if session is active and NOT ending or ended
    if (this.isEnding || this.isEnded || this.conversationState === 'ENDING' || this.conversationState === 'ENDED') {
      console.log(`[VOICE RESPONSE] tool result recorded, suppressing follow-up response.create because session is ${this.conversationState}`);
      return;
    }

    // 3. Trigger next response
    this._send({
      type: 'response.create'
    });
  }

  _send(payload) {
    if (payload.type === 'response.create' && (this.isEnding || this.isEnded || this.conversationState === 'ENDING' || this.conversationState === 'ENDED')) {
      console.log(`[VOICE RESPONSE] blocked response.create because session is ${this.conversationState}`);
      return;
    }

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify(payload));
      } catch (err) {
        console.warn(`[VOICE] Failed to send WebSocket payload to OpenAI: ${err.message}`);
      }
    }
  }

  close() {
    if (this._closing) return;
    this._closing = true;
    this.isConnected = false;

    if (this.ws) {
      try {
        this.ws.removeAllListeners();
        this.ws.close();
      } catch (err) {
        // Silently swallow
      }
      this.ws = null;
    }
    this.emit('closed', { reason: 'Clean client close' });
  }
}

module.exports = OpenAiRealtimeProvider;
