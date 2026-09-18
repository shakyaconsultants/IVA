# Voice AI Architecture: Bidirectional Telephony & Realtime AI Pipeline

## 1. Overview & Architecture

This document describes the complete bidirectional Realtime AI Voice Calling pipeline implemented for the UK IVA Cold Calling CRM.

The system connects live UK outbound PSTN/mobile telephone calls on Twilio to the OpenAI Realtime Voice WebSocket API via an asynchronous Node.js Voice Gateway.

```
+-----------------------------------------------------------------------------------+
|                                 Node.js Backend                                   |
|                                                                                   |
|  +------------------+         +--------------------+         +-----------------+  |
|  |  Twilio Media    |         |    Voice Gateway   |         | OpenAI Realtime |  |
|  |  Stream WS       |<------->|    VoiceSession    |<------->| Client WS       |  |
|  |  (/media/:callId)|         |   SessionManager   |         | (g711_ulaw)     |  |
|  +--------^---------+         +---------^----------+         +--------^--------+  |
+-----------|-----------------------------|-----------------------------|-----------+
            |                             |                             |
            | (G.711 u-law / 8kHz)        | Socket.IO                   | (G.711 u-law / 8kHz)
            v                             v                             v
+-----------------------+     +-----------------------+     +-----------------------+
|     Twilio Voice      |     |  React CRM Frontend   |     |    OpenAI Realtime    |
|   (UK PSTN / Mobile)  |     |  (LiveCalls / Trans.) |     |     Voice Engine      |
+-----------------------+     +-----------------------+     +-----------------------+
```

---

## 2. End-to-End Call Flow

1. **Initiation**:
   - Backend initiates call via Twilio REST API (`POST /2010-04-01/Accounts/{SID}/Calls.json`).
   - Twilio requests TwiML from `POST /api/webhooks/twilio/voice/:callId`.
2. **Bidirectional Stream Establishment**:
   - Webhook returns TwiML with `<Connect><Stream url="wss://PUBLIC_BASE_URL/api/webhooks/twilio/media/{callId}" /></Connect>`.
   - Twilio upgrades connection to the Node.js WebSocket server.
3. **Session Creation**:
   - `VoiceGateway` handles the connection and creates a `VoiceSession` in `sessionManager`.
   - Twilio sends `start` event containing `streamSid` and `callSid`.
   - `sessionManager` registers `streamSid -> VoiceSession`.
4. **Agent Prompt & AI Initialization**:
   - System loads lead data, campaign config, and `AgentPrompt`.
   - Agent system prompt and opening script are formatted with lead/agent variables.
   - `OpenAiRealtimeProvider` connects to `wss://api.openai.com/v1/realtime?model=gpt-realtime-1.5` using GA Bearer token authentication (without deprecated `OpenAI-Beta` headers).
   - Sends GA `session.update` configuring:
     - `session.type: 'realtime'`
     - `session.output_modalities: ['audio']`
     - `audio.input.format: { type: 'audio/pcmu' }`
     - `audio.output.format: { type: 'audio/pcmu' }`
     - `audio.output.voice: 'alloy'`
     - `audio.input.turn_detection: { type: 'server_vad' }`
     - `audio.input.transcription: { model: 'whisper-1' }`
     - Tool definitions (`mark_interested`, `transfer_call`, `save_notes`, `update_disposition`, `schedule_callback`, `end_call`).
5. **Initial Spoken Greeting**:
   - Once AI session is ready, the gateway immediately triggers exactly one initial spoken greeting using the configured `openingScript`.
   - Customer hears the AI speaking as soon as they answer.
6. **Customer Speech -> AI**:
   - Twilio streams base64-encoded G.711 μ-law audio packets in `media` events.
   - Gateway forwards payload directly to `OpenAiRealtimeProvider.sendAudio()`, sending `input_audio_buffer.append`.
7. **AI Speech -> Customer**:
   - OpenAI Realtime returns audio deltas (`response.output_audio.delta`) in G.711 μ-law base64 format.
   - Gateway immediately wraps payload into Twilio JSON:
     ```json
     {
       "event": "media",
       "streamSid": "<TWILIO_STREAM_SID>",
       "media": {
         "payload": "<BASE64_MULAW_AUDIO>"
       }
     }
     ```
   - Twilio plays audio to the customer.
8. **Barge-In / Interruption**:
   - When customer starts speaking while AI is speaking, OpenAI emits `input_audio_buffer.speech_started`.
   - Gateway immediately sends Twilio clear message:
     ```json
     {
       "event": "clear",
       "streamSid": "<TWILIO_STREAM_SID>"
     }
     ```
   - Twilio instantly flushes its playback buffer, silencing the AI.
   - Gateway cancels any active AI response and switches state to `interrupted`/`listening`.
9. **Transcripts & Live Updates**:
   - User transcripts: Captured on `conversation.item.input_audio_transcription.completed`.
   - Assistant transcripts: Captured on `response.audio_transcript.done`.
   - Gateway emits `transcript:update` and `call:update` to frontend via Socket.IO.
10. **Termination & Persistence**:
    - On call hangup (`stop` event, client close, or `end_call` tool), session stops timers, finalizes transcript in `Call.transcript`, calculates duration/cost, updates `Call` and `Lead` in MongoDB, and cleanly releases resources.

---

## 3. Audio Format & Pass-Through Bridge

- **Twilio Media Streams**:
  - Codec: G.711 μ-law (PCMU)
  - Sample Rate: 8000 Hz
  - Channels: 1 (mono)
  - Encoding: Base64 inside JSON WebSocket messages
- **OpenAI Realtime API**:
  - Format: `g711_ulaw`
  - Sample Rate: 8000 Hz
  - Payload: Base64 in `input_audio_buffer.append` and `response.audio.delta`

**Zero Transcoding Architecture**: Because both endpoints exchange 8 kHz G.711 μ-law audio directly in base64, no intermediate transcoding, ffmpeg process, or resampling is necessary. This minimizes latency and CPU consumption.

---

## 4. Voice Tool Architecture

The AI is equipped with 6 deterministic tools:

1. `mark_interested({ level, debtAmount })`:
   - Records customer interest and unsecured debt.
   - Runs deterministic qualification engine against `AgentPrompt.qualificationRules`.
   - Updates `Call` and `Lead` records.
2. `transfer_call({ phone, reason })`:
   - Validates that call is active and permitted to transfer.
   - Triggers Twilio call transfer (`<Dial>`) via `twilioService.transferCall`.
   - Records `Transfer` document and `CallEvent`.
3. `save_notes({ notes })`:
   - Appends notes to `Call.notes` and `Lead.notes`.
4. `update_disposition({ disposition, reason })`:
   - Validates disposition against allowed categories (`Qualified`, `Interested`, `Not Interested`, `Callback Requested`, `DNC`, etc.).
   - Sets DNC flag on Lead if requested.
5. `schedule_callback({ datetime, notes })`:
   - Records requested date/time and updates disposition to `Callback Requested`.
6. `end_call({ reason })`:
   - Initiates clean Twilio hangup and finalizes session.

**Safety Rule**: The LLM never writes directly to the database or modifies telephony state; all tool calls route through validated gateway handlers.

---

## 5. Environment Variables

| Variable | Description | Default / Example |
|---|---|---|
| `OPENAI_API_KEY` | OpenAI API Key with Realtime API access | `sk-proj-...` |
| `OPENAI_REALTIME_MODEL` | Realtime voice model | `gpt-realtime-1.5` |
| `OPENAI_REALTIME_VOICE` | Voice persona (`alloy`, `shimmer`, `echo`, etc.) | `alloy` |
| `OPENAI_REALTIME_AUDIO_FORMAT` | Audio format | `pcmu` / `g711_ulaw` |
| `OPENAI_REALTIME_AUDIO_SAMPLE_RATE` | Sample rate | `8000` |
| `VOICE_AI_ENABLED` | Master switch for realtime voice AI | `true` |
| `PUBLIC_BASE_URL` | Public HTTPS URL for Twilio webhooks | `https://your-domain.ngrok-free.dev` |
| `TWILIO_ACCOUNT_SID` | Twilio Account SID | `AC...` |
| `TWILIO_AUTH_TOKEN` | Twilio Auth Token | `...` |
| `TWILIO_CALLER_ID` | Verified UK outbound caller ID | `+447479274450` |
| `DEFAULT_TRANSFER_NUMBER` | Specialist destination number | `+443300271295` |

---

## 6. How to Test a Real Phone Call

1. **Start Backend & Frontend**:
   ```powershell
   # Terminal 1: Backend
   cd backend
   npm run dev

   # Terminal 2: Frontend
   cd frontend
   npm run dev
   ```
2. **Start Public Webhook Tunnel**:
   ```powershell
   ngrok http 5000
   ```
   Copy the `https://...` URL into `backend/.env` under `PUBLIC_BASE_URL`.
3. **Verify Health Endpoint**:
   ```powershell
   curl http://localhost:5000/api/health
   ```
   Ensure `mongodb`, `twilio`, and `openaiRealtime` report configured/connected.
4. **Trigger a Test Call**:
   In the CRM header Quick Dialer (or via `POST /api/calls/start`):
   ```powershell
   curl -X POST http://localhost:5000/api/calls/start -H "Content-Type: application/json" -d '{"phone": "+44XXXXXXXXXX", "name": "Test Prospect"}'
   ```
5. **Answer Call**:
   - Customer answers phone.
   - AI speaks greeting immediately: "Hi Test Prospect, this is Sarah calling from Beacon Debt Advisory...".
   - Customer responds and converses naturally with the AI.
   - Speak while the AI speaks to verify barge-in interruption.
   - Monitor the live transcript and AI status on the `Live Calls` screen (`http://localhost:5173/live-calls`).
