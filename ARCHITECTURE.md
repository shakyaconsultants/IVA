# ARCHITECTURE.md — UK IVA Outbound AI Voice Agent & CRM Platform

> **Document Version**: 2.2 (MVP Current State)  
> **Last Updated**: March 2026  
> **Scope**: Accurate documentation of what is **ACTUALLY implemented and working today**.  
> **Status**: Phase 1 (Voice Infrastructure), Phase 2.1 (Structured Qualification Foundation), and Phase 2.2 (Client-Controlled Agent Instructions) are complete with **118 automated tests passing**.

---

## 1. Architectural Principles

The platform follows a strict pragmatic principle: **"Keep the MVP simple, deterministic, and working end-to-end."**

```text
CLIENT (Browser)
   ↓ HTTP / REST API + Socket.IO (Signaling & Dashboard only)
NODE.JS BACKEND (Express + MongoDB)
   ↕ WebSockets (Twilio Media Streams & OpenAI Realtime GA)
TWILIO VOICE (UK PSTN) ↔ OPENAI REALTIME (gpt-realtime-1.5)
```

### Core Separation of Responsibilities
1. **The Client Defines How the Agent Behaves**:
   - Conversational persona, tone, guidelines, and objections.
   - Initial spoken greeting and company positioning.
   - Pacing behaviours (one question at a time, allowing interruptions, offering callbacks/transfers).
2. **The AI Handles Dialogue & Speech**:
   - Natural speech understanding and low-latency speech generation.
   - Extracting facts from prospect utterances.
   - Deciding when to invoke available tools.
   - Never makes legal promises or decides qualification conclusions.
3. **The Backend Controls What the System is Allowed to Do**:
   - Telephony lifecycle, Twilio Media Stream bridging, and audio codecs.
   - Deterministic qualification evaluation (separating customer facts from business rules).
   - Safe tool execution, input validation, and normalization.
   - Database persistence, audit trails, and tenant security.
   - Call termination and warm transfers.

---

## 2. System Architecture Diagram

```text
                               ┌────────────────────────────────────────┐
                               │       Client Browser / Dashboard       │
                               │  (React + Tailwind + Vite + Lucide)   │
                               └───────────────────┬────────────────────┘
                                                   │
                       HTTP REST API               │  Socket.IO (Live Telemetry:
                       (Auth, Leads, Campaigns,    │  call:new, call:update,
                        Agent Config, History)     │  transcript:update, duration)
                                                   │
                                                   ▼
┌───────────────────────────────────────────────────────────────────────────────────────┐
│                                 Node.js / Express Backend                             │
│                                                                                       │
│  ┌───────────────────────┐   ┌───────────────────────────┐   ┌─────────────────────┐  │
│  │   REST Controllers    │   │     InstructionBuilder    │   │  QualificationEngine│  │
│  │  (Auth, AI, Leads,    │   │  (Platform Rules + Client │   │  (Deterministic     │  │
│  │   Campaigns, Calls)   │   │   Instructions + Context) │   │   Fact Evaluation)  │  │
│  └───────────┬───────────┘   └─────────────┬─────────────┘   └──────────┬──────────┘  │
│              │                             │                            │             │
│              ▼                             ▼                            ▼             │
│  ┌───────────────────────┐   ┌───────────────────────────┐   ┌─────────────────────┐  │
│  │    MongoDB Atlas      │   │       VoiceGateway        │   │    ToolRegistry     │  │
│  │  (Calls, Leads,       │   │  (Session Management,     │   │  (update_qual,      │  │
│  │   AgentPrompt, Events)│   │   Audio Bridge, State)    │   │   transfer, end...) │  │
│  └───────────────────────┘   └─────────────┬─────────────┘   └──────────▲──────────┘  │
└────────────────────────────────────────────┼────────────────────────────┼─────────────┘
                                             │                            │
                   Twilio Media Stream       │                            │ OpenAI Realtime GA
                   (Bi-directional WS,       │                            │ (Bi-directional WS,
                    PCMU 8kHz μ-law)         │                            │  PCMU 8kHz μ-law)
                                             ▼                            │
                       ┌───────────────────────────┐                      │
                       │       Twilio Voice        │                      ▼
                       │     (UK PSTN Network)     │          ┌───────────────────────┐
                       └─────────────┬─────────────┘          │    OpenAI Realtime    │
                                     │                        │  (gpt-realtime-1.5)   │
                                     ▼                        └───────────────────────┘
                       ┌───────────────────────────┐
                       │    Customer / Prospect    │
                       │       (UK Phone)          │
                       └───────────────────────────┘
```

> **Note**: The frontend browser is **NOT** in the live audio path. Audio streams directly between Twilio and the Node.js Voice Gateway, and between the Voice Gateway and OpenAI Realtime.

---

## 3. Directory & File Inventory

The repository is divided into `backend/` and `frontend/`:

```text
├── backend/
│   ├── src/
│   │   ├── server.js                        # HTTP server, WebSocket dispatch, route mounting
│   │   ├── seed.js                          # Initial database seeding
│   │   ├── config/
│   │   │   ├── db.js                        # Mongoose MongoDB connection
│   │   │   └── redis.js                     # Redis configuration & availability check
│   │   ├── controllers/
│   │   │   └── authMiddleware.js            # JWT verification & tenant user attachment
│   │   ├── models/
│   │   │   ├── AgentPrompt.js               # Client agent instructions & persona schema
│   │   │   ├── Call.js                      # Call entity, qualification state, disposition
│   │   │   ├── CallEvent.js                 # Low-level call audit events
│   │   │   ├── Campaign.js                  # Outbound dialing campaign entity
│   │   │   ├── CampaignLead.js              # Campaign-to-lead join table
│   │   │   ├── Company.js                   # Tenant company entity
│   │   │   ├── Disposition.js               # Call disposition types
│   │   │   ├── Lead.js                      # Prospect lead entity
│   │   │   ├── Settings.js                  # Platform rates and AMD settings
│   │   │   ├── Transfer.js                  # Transfer destination logs
│   │   │   └── User.js                      # Operator accounts & bcrypt passwords
│   │   ├── queues/
│   │   │   └── queueManager.js              # BullMQ / In-Memory fallback dialing queue
│   │   ├── routes/
│   │   │   ├── aiRoutes.js                  # Agent configuration CRUD & sandbox testing
│   │   │   ├── analyticsRoutes.js           # Funnel analytics endpoints
│   │   │   ├── authRoutes.js                # Register, login, /me
│   │   │   ├── callRoutes.js                # Manual call start, list live, history
│   │   │   ├── campaignRoutes.js            # Campaign CRUD & start/pause/stop
│   │   │   ├── leadRoutes.js                # Excel/CSV upload, mapping, batch import
│   │   │   ├── settingsRoutes.js            # Settings CRUD
│   │   │   ├── transferRoutes.js            # Transfer destinations
│   │   │   └── webhookRoutes.js             # Twilio Voice TwiML, status & media hooks
│   │   ├── services/
│   │   │   ├── billingService.js            # Call cost calculations in GBP (£)
│   │   │   ├── twilioMediaStream.js         # HTTP upgrade to WebSocket for Twilio stream
│   │   │   ├── twilioService.js             # Twilio REST API client (originate, transfer)
│   │   │   └── ukPhoneValidator.js          # E.164 normalization for UK phone numbers
│   │   ├── voice/
│   │   │   ├── VoiceSession.js              # In-memory call state machine & qualification state
│   │   │   ├── sessionManager.js            # Active session registry
│   │   │   ├── voiceGateway.js              # Media stream bridging, prewarming, playback
│   │   │   ├── instructionBuilder.js        # 3-tier Layered Instruction Architecture
│   │   │   ├── qualificationConstants.js    # Data contract, statuses, field definitions
│   │   │   ├── qualificationNormalization.js# Deterministic currency & enum normalizer
│   │   │   ├── qualificationEngine.js       # Deterministic evaluation rules engine
│   │   │   ├── providers/
│   │   │   │   └── openaiRealtimeProvider.js# OpenAI Realtime GA WebSocket client
│   │   │   └── tools/
│   │   │       ├── toolRegistry.js          # Tool definitions & dispatcher
│   │   │       ├── qualificationTools.js    # update_qualification & mark_interested
│   │   │       ├── transferCall.js          # Live specialist warm transfer
│   │   │       ├── saveNotes.js             # Note persistence to lead
│   │   │       ├── updateDisposition.js     # Call outcome assignment
│   │   │       ├── scheduleCallback.js      # Callback arrangement
│   │   │       └── endCall.js               # Polite termination trigger
│   │   └── websocket/
│   │       └── socketServer.js              # Socket.IO telemetry server
│   └── tests/
│       ├── agentInstructions.test.js        # Phase 2.2 Client instruction tests (12 tests)
│       ├── structuredQualification.test.js  # Phase 2.1 Structured qualification tests (22 tests)
│       ├── qualificationEngine.test.js      # Deterministic engine tests (6 tests)
│       ├── openaiRealtimeProvider.test.js    # GA protocol, PCMU, mark sync (44 tests)
│       ├── sessionManager.test.js           # VoiceSession lifecycle tests (6 tests)
│       ├── toolRegistry.test.js             # Tool schemas & execution (4 tests)
│       └── twilioMediaParsing.test.js       # Media Stream packet parsing (6 tests)
│
└── frontend/
    ├── src/
    │   ├── App.jsx                          # Main shell & tab switcher
    │   ├── components/
    │   │   └── Layout.jsx                   # Sidebar navigation & live call counter
    │   ├── context/
    │   │   ├── AuthContext.jsx              # User token management
    │   │   └── SocketContext.jsx            # Socket.IO connection hook
    │   ├── pages/
    │   │   ├── Dashboard.jsx                # High-level KPIs and active campaign overview
    │   │   ├── AiAgent.jsx                  # Client instructions & persona configuration
    │   │   ├── UploadLeads.jsx              # 3-step CSV/Excel upload wizard
    │   │   ├── Campaigns.jsx                # Campaign manager & lead assigner
    │   │   ├── LiveCalls.jsx                # Real-time ongoing call monitor & transcripts
    │   │   ├── CallHistory.jsx              # Searchable call logs, filters, and transcripts
    │   │   ├── LeadManagement.jsx           # CRM lead table with search and pagination
    │   │   ├── Analytics.jsx                # Conversion funnel & disposition breakdown
    │   │   ├── Settings.jsx                 # Billing rates, AMD thresholds, profile
    │   │   └── Login.jsx                    # Operator login screen
    │   └── services/
    │       └── api.js                       # Axios HTTP client with Bearer interceptor
```

---

## 4. Voice & Telephony Architecture (Phase 1)

### The Audio Pipeline
- **Twilio Voice Integration**: Twilio originates calls to UK numbers using the REST API (`POST /2010-04-01/Accounts/.../Calls.json`) with `MachineDetection: Enable`.
- **TwiML Stream Connection**: When the call connects, Twilio requests TwiML from `/api/webhooks/twilio/voice/:callId`. The backend responds with:
  ```xml
  <Response>
    <Connect>
      <Stream url="wss://PUBLIC_BASE_URL/api/webhooks/twilio/media/:callId" />
    </Connect>
  </Response>
  ```
- **Codec & Format**: Direct **PCMU (G.711 $\mu$-law) 8 kHz mono**.
  - Inbound Twilio media packets are forwarded as raw 8 kHz $\mu$-law chunks to OpenAI `input_audio_buffer.append`.
  - Outbound OpenAI audio deltas (`response.output_audio.delta`) are forwarded directly to Twilio as Base64-encoded $\mu$-law frames.
- **Prewarmed Session**: The OpenAI Realtime session begins connecting in parallel as soon as the TwiML webhook fires, eliminating connection latency before the prospect speaks. Exactly **one OpenAI session** is created per call.
- **Voice Lifecycle State Machine**:
  ```text
  CALL_CONNECTED
        ↓
  INITIAL_GREETING ──(interrupted / complete)──► WAITING_FOR_PROSPECT
                                                        ↕
                                                 PROSPECT_SPEAKING
                                                        ↕
                                                   AI_THINKING
                                                        ↕
                                                   AI_SPEAKING
                                                        ↓
                                                     ENDING
                                                        ↓
                                                     ENDED (terminal)
  ```
- **Barge-In & Response Cancellation**: When customer speech is detected (`speech_started`), Twilio receives a `clear` message to clear jitter buffers, and OpenAI receives `response.cancel`.
- **Twilio Mark Playback Synchronization**: When terminating a call (`end_call`), the final goodbye audio plays fully. A Twilio `mark` is emitted; only when Twilio fires the corresponding `mark` event confirming audio playback completion does the call hang up.

---

## 5. Client-Controlled Agent Instructions (Phase 2.2)

Clients configure their agent's conversational personality and behaviour through the **AI Voice Agent** dashboard ([`AiAgent.jsx`](file:///c:/Users/Lenovo/Desktop/Workspace/start%20(2)/frontend/src/pages/AiAgent.jsx)).

```text
CLIENT INSTRUCTIONS DASHBOARD (AiAgent.jsx)
        ↓ PUT /api/ai/agent/:id
MONGODB (AgentPrompt document)
        ↓ Snapshot loaded at call start (VoiceSession.agentConfigSnapshot)
INSTRUCTION BUILDER (instructionBuilder.js)
        ↓ session.update
OPENAI REALTIME GA SESSION
```

### Layered Instruction Architecture
Prompt assembly is organized into 4 distinct layers:
1. **`[PLATFORM RULES]`** (Non-negotiable backend constraints):
   - Telephony rules (short 1-2 sentence turns, no monologues, interruptible).
   - Tool usage rules (`update_qualification`, `transfer_call`, `schedule_callback`, `end_call`).
   - Strict qualification boundaries: the AI is prohibited from declaring "You definitely qualify" or overriding qualification state directly.
2. **`[CLIENT AGENT INSTRUCTIONS]`**:
   - The client's natural-language instructions (speaking style, objection handling, company positioning). If empty, defaults safely to `DEFAULT_CLIENT_INSTRUCTIONS`.
3. **`[AGENT SETTINGS & BEHAVIOUR]`**:
   - Persona tone (`professional`, `empathetic`, `friendly`, `direct`, `calm`).
   - Conversational toggles (`askOneQuestionAtATime`, `allowInterruptions`, `offerCallback`, `transferOnRequest`).
4. **`[CALL CONTEXT]`**:
   - Dynamic per-call parameters (`[LeadName]`, `[AgentName]`, `[CompanyName]`, phone number).

### Configuration Snapshotting
- At call initialization, the agent configuration is cloned onto `session.agentConfigSnapshot` and versioned.
- An active call uses its immutable snapshot for its entire duration. Edits made in the dashboard apply to **new calls** without destabilizing live conversations.

---

## 6. Structured Qualification Foundation (Phase 2.1)

Qualification facts collected from prospects are evaluated **deterministically by the backend**, separating customer facts from business rules:

```text
PROSPECT UTTERANCE ("I owe £12,500 on 3 credit cards")
        ↓
OPENAI REALTIME AGENT CALLS TOOL:
update_qualification(field="debt.totalAmount", value=12500)
        ↓
BACKEND NORMALIZATION & VALIDATION (qualificationNormalization.js)
        ↓
STATE MUTATION (VoiceSession.qualificationState)
        ↓
DETERMINISTIC EVALUATION (qualificationEngine.js)
        ↓
AUDIT TRAIL LOGGED + MONGO PERSISTENCE (Call & Lead updated)
        ↓
STRUCTURED TOOL RESPONSE RETURNED TO AI
```

### Structured Qualification State Contract
```javascript
{
  debt: {
    totalAmount: Number,        // Unsecured debt amount in GBP (£)
    creditorCount: Number,      // Count of separate lenders
    types: [String],            // 'credit_card', 'loan', 'overdraft', etc.
    priorityDebtPresent: Boolean// Rent, council tax, HMRC arrears
  },
  income: {
    employmentStatus: String,   // 'employed', 'self_employed', 'benefits', etc.
    monthlyIncome: Number,      // Net monthly household income in GBP (£)
    benefits: Boolean           // State benefit status
  },
  expenditure: {
    monthlyExpenses: Number,    // Monthly household expenses in GBP (£)
    disposableIncome: Number    // Calculated or reported surplus
  },
  housing: {
    status: String,             // 'homeowner', 'tenant_private', 'tenant_council', etc.
    mortgageBalance: Number,    // Homeowner mortgage balance
    arrears: Boolean            // Arrears status
  },
  assets: {
    ownsProperty: Boolean,
    ownsVehicle: Boolean,
    otherAssets: String
  },
  existingSolutions: [String],  // 'dmp', 'iva', 'bankruptcy', 'dro', 'none'
  residency: {
    ukResident: Boolean,        // UK residency flag
    region: String              // 'England', 'Wales', 'Northern Ireland', 'Scotland'
  }
}
```

### Qualification Statuses
- `IN_PROGRESS`: Required fields incomplete (`UNKNOWN` checks) and no failures.
- `INFORMATION_COMPLETE`: All qualification facts collected.
- `POTENTIAL_REFERRAL`: Meets all configured business thresholds; eligible for referral.
- `NEEDS_REVIEW`: Meets thresholds but has priority arrears, property equity, or past insolvency.
- `NOT_SUITABLE`: Fails one or more configured checks (`debtAmount < minDebtAmount`, `creditors < minCreditors`, or unsupported region).
- `CUSTOMER_DECLINED`: Customer expressed disinterest or requested DNC.
- `CALLBACK_REQUIRED`: Customer requested a callback at a later time.
- `TRANSFER_READY`: Qualified prospect prepared for warm live transfer.

### Check Statuses
Each criterion evaluates to one of:
- `PASS`
- `FAIL`
- `UNKNOWN` (Distinguishes missing information from failed rules)

---

## 7. Tool Architecture

Tools are defined in [`toolRegistry.js`](file:///c:/Users/Lenovo/Desktop/Workspace/start%20(2)/backend/src/voice/tools/toolRegistry.js) using standard OpenAI Realtime function schemas:

```text
OpenAI Realtime Agent
         ↓ Function Call Request
Node.js Tool Registry (executeTool)
         ↓
Specific Tool Handler:
├── update_qualification  -> Normalizes facts, evaluates rules, updates state, logs audit
├── mark_interested       -> Legacy qualification fact updater
├── transfer_call         -> Warm live transfer to senior specialist phone number
├── save_notes            -> Persists qualitative notes to Lead document
├── update_disposition    -> Sets call outcome (Qualified, DNC, Not Interested, etc.)
├── schedule_callback     -> Arranges requested callback datetime
└── endCall               -> Initiates graceful playback & mark-based hangup
         ↓
Deterministic Tool Response sent back to OpenAI
```

---

## 8. Database Architecture (MongoDB Models)

The system uses 11 Mongoose models:

```text
                     ┌──────────────┐
                     │   Company    │
                     └──────┬───────┘
                            │ 1:N
                     ┌──────▼───────┐
                     │     User     │ (Admins, Managers, Agents)
                     └──────────────┘

┌─────────────────┐  1:N   ┌──────────────┐  1:N   ┌──────────────┐
│   AgentPrompt   │◄───────┤   Campaign   ├───────►│ CampaignLead │
│(Config/Persona) │        └──────┬───────┘        └──────┬───────┘
└────────┬────────┘               │ 1:N                   │ N:1
         │                        ▼                       ▼
         │ 1:N             ┌──────────────┐  1:N   ┌──────────────┐
         └────────────────►│     Call     ├───────►│     Lead     │
                           └──────┬───────┘        └──────────────┘
                                  │ 1:N
                           ┌──────▼───────┐
                           │  CallEvent   │ (Audit trail)
                           └──────────────┘
```

### Entity Summary
1. **`Call`**: Individual voice call record (`callId`, `providerCallId`, `status`, `aiStatus`, `disposition`, `qualificationStatus`, `qualification`, `transcript[]`, `durationSec`, `cost`, `agentConfigVersion`).
2. **`Lead`**: Consumer prospect record (`phone`, `name`, `email`, `debtAmount`, `creditorCount`, `postcode`, `status`, `disposition`, `attempts`, `qualification`, `qualificationStatus`).
3. **`Campaign`**: Outbound calling campaign (`name`, `status`, `callingHoursStart`, `callingHoursEnd`, `maxCPS`, `concurrentCalls`, `agentId`, `totalLeads`, `dialedLeads`).
4. **`CampaignLead`**: Join table tracking lead status per campaign (`pending`, `called`, `skipped`).
5. **`AgentPrompt`**: Persona and instruction configuration (`name`, `instructions`, `greeting`, `tone`, `voice`, `language`, `behaviour`, `qualificationRules`, `transferRules`, `version`).
6. **`CallEvent`**: Detailed timestamped event log (`callId`, `eventType`, `payload`).
7. **`User`**: System users with bcrypt password hashing (`name`, `email`, `role`, `companyId`).
8. **`Company`**: Client organization (`name`, `ukCompanyNumber`, `transferPhone`).
9. **`Settings`**: System-wide telephony and billing parameters.
10. **`Transfer`**: Historical transfer destination log.
11. **`Disposition`**: Standardized disposition categories.

---

## 9. Real-Time Telemetry (Socket.IO)

Socket.IO provides real-time updates to the web dashboard (Live Calls, Call History, and Dashboard KPIs). It is **not** used for voice audio streaming.

### Emitted Events
- **`call:new`**: Emitted when an outbound call is originated.
- **`call:update`**: Emitted on status changes (ringing, in-call, completed, disposition updates).
- **`call:ended`**: Emitted when a call concludes with final duration and disposition.
- **`call:duration`**: Emitted every second for active calls to update live duration timers.
- **`transcript:update`**: Emitted when user or AI speech is transcribed.
- **`ai:status`**: Emitted when AI status changes (`connecting`, `listening`, `thinking`, `speaking`).
- **`ai:state`**: Emitted when the voice state machine transitions (`INITIAL_GREETING`, `AI_SPEAKING`, etc.).

---

## 10. Lead Management (Current State)

### Implemented Capabilities
- **File Upload**: Supports Excel (`.xlsx`, `.xls`) and CSV files via `multer` and `xlsx` at `POST /api/leads/upload`.
- **Header Detection & Suggested Mapping**: Auto-detects columns for `phone`, `name`, `email`, `debtAmount`, `creditorCount`, and `postcode`.
- **UK Phone Normalization**: Strips spaces, symbols, and standardizes UK numbers to E.164 (`+447...` or `+44...`) via [`ukPhoneValidator.js`](file:///c:/Users/Lenovo/Desktop/Workspace/start%20(2)/backend/src/services/ukPhoneValidator.js).
- **Deduplication & Import**: Prevents duplicate phone imports within the same campaign.
- **Batch Processing**: Handled via `processLeadBatch` in [`queueManager.js`](file:///c:/Users/Lenovo/Desktop/Workspace/start%20(2)/backend/src/queues/queueManager.js).
- **Lead Listing & CRM View**: `GET /api/leads` provides search by name/phone/email, filter by campaign/status/disposition, and pagination.

### Gaps / Not Yet Implemented
- 🔴 Automated Telephone Preference Service (TPS) registry scrubbing.
- 🔴 Exporting filtered leads back to CSV.
- 🔴 Manual individual lead creation form (currently relies on file upload or test script).

---

## 11. Call Campaigns (Current State)

### Implemented Capabilities
- **Campaign CRUD**: Create, read, update, and delete campaigns at `/api/campaigns`.
- **Campaign Configuration**: Set calling hours, Max CPS (calls per second), Max Concurrent Calls, and assign an AI Agent persona (`agentId`).
- **Lead Assignment**: `POST /api/campaigns/:id/assign-leads` assigns batches of unallocated leads to a campaign.
- **Dialing Queue**:
  - Uses BullMQ with Redis if available.
  - Automatically falls back to an **In-Memory Dialing Loop** (`startMemoryDialerLoop`) when Redis is absent (e.g. local development on Windows).
  - Pacing loop dispatches 1 call per second, respecting `concurrentCalls` limits.
- **Campaign Lifecycle**: Supports `draft`, `running`, `paused`, and `stopped` states.

### Gaps / Not Yet Implemented
- 🟡 Calling hours enforcement (start/end times are stored on the model but not automatically blocking dials in the queue loop).
- 🟡 Automatic multi-attempt dial retries for busy / unanswered leads.

---

## 12. Frontend Dashboard Inventory

Built with **React, Vite, and TailwindCSS**:

| Screen / Page | URL / Tab | Current MVP Purpose |
| :--- | :--- | :--- |
| **Dashboard** | `dashboard` | Operational overview: live call count, total dialed leads, qualified leads, active campaigns. |
| **AI Voice Agent** | `ai-agent` | Client instruction editor, persona tone, greeting, behaviour toggles, and live interactive test sandbox. |
| **Upload Leads** | `upload-leads` | 3-step wizard: Upload Excel/CSV $\rightarrow$ Column auto-mapping $\rightarrow$ Validation & Import. |
| **Campaigns** | `campaigns` | Campaign management: create campaigns, assign leads, start/pause/stop dialing. |
| **Live Calls** | `live-calls` | Real-time monitoring of live calls with state machine status badges, duration timers, and live transcripts. |
| **Call History** | `call-history` | Searchable historical call logs with filtering, audio duration, cost in GBP, and expandable dialogue transcripts. |
| **Lead Management** | `lead-management` | Tabular CRM view of leads with search, campaign filters, debt figures, and status. |
| **Analytics** | `analytics` | Conversion funnel visualization (Dialed $\rightarrow$ Answered $\rightarrow$ Human $\rightarrow$ Qualified $\rightarrow$ Transferred). |
| **Settings** | `settings` | System-wide telephony configuration, billing rates (Twilio/OpenAI), and operator profile. |
| **Login** | `/login` | Operator authentication with JWT credentials. |

---

## 13. End-to-End MVP Data Flow

```text
1. OPERATOR / CLIENT
   ├── Logs into dashboard (JWT authenticated)
   ├── Configures Agent Persona & Instructions (AiAgent.jsx)
   ├── Uploads Leads from Excel / CSV (UploadLeads.jsx)
   └── Creates Campaign & clicks "Start Campaign" (Campaigns.jsx)

2. QUEUE & OUTBOUND DIALING
   ├── Campaign triggers triggerCampaignDial(campaignId)
   ├── Dialer queue respects concurrent call limits & CPS pacing
   └── Twilio REST API originates call to UK phone number with MachineDetection

3. ANSWERING & VOICE GATEWAY BRIDGING
   ├── Prospect answers phone ("Hello?")
   ├── Twilio requests TwiML -> backend starts asynchronous prewarming of OpenAI session
   ├── Twilio connects bi-directional WebSocket Media Stream
   └── VoiceGateway attaches to prewarmed VoiceSession

4. AI VOICE CONVERSATION
   ├── AI delivers initial greeting using client's openingScript
   ├── Bi-directional audio flows over PCMU 8kHz μ-law
   ├── Prospect speaks -> Whisper-1 transcribes -> GPT Realtime responds
   └── Barge-in: customer speech cancels AI audio and clears Twilio buffer

5. DETERMINISTIC QUALIFICATION
   ├── Customer states: "I owe £14,000 across 4 credit cards"
   ├── AI invokes update_qualification(field="debt.totalAmount", value=14000)
   ├── Backend normalizes input, updates qualificationState, evaluates rules
   ├── Deterministic outcome computed (status="POTENTIAL_REFERRAL", qualified=true)
   └── Call and Lead records updated in MongoDB; audit event logged

6. CALL CONCLUSION & PERSISTENCE
   ├── AI offers warm transfer or callback, speaks polite goodbye
   ├── Tool end_call initiates hangup -> final goodbye audio plays fully
   ├── Twilio mark event confirms audio completion -> Twilio hangs up
   └── Final transcript, duration, cost, and disposition saved to MongoDB & displayed in CRM
```

---

## 14. Current MVP Scope

### Implementation Status Matrix

| Component | Status | Details |
| :--- | :---: | :--- |
| **Twilio Outbound Calling** | ✅ Implemented | REST API call origination, TwiML generation, status webhooks. |
| **Bi-directional Media Streams** | ✅ Implemented | WebSocket audio relay, PCMU 8kHz $\mu$-law transcoding. |
| **OpenAI Realtime GA Provider** | ✅ Implemented | WebSocket client for `gpt-realtime-1.5`, turn detection, server VAD. |
| **Voice State Machine** | ✅ Implemented | 8-state model with race-condition guards and prewarm lifecycle. |
| **Barge-In / Interruption** | ✅ Implemented | `speech_started` $\rightarrow$ Twilio `clear` $\rightarrow$ OpenAI `response.cancel`. |
| **Mark-Based Hangup Sync** | ✅ Implemented | Ensures goodbye audio finishes playing before terminating call. |
| **Client Agent Instructions** | ✅ Implemented | Full dashboard UI, 3-tier instruction builder, tone & behaviour toggles. |
| **Configuration Snapshotting** | ✅ Implemented | Calls snapshot configuration at start; live calls immune to mid-call edits. |
| **Structured Qualification** | ✅ Implemented | Fact contract, normalization, PASS/FAIL/UNKNOWN checks, status model. |
| **Tool Registry & Execution** | ✅ Implemented | `update_qualification`, `transfer_call`, `save_notes`, `end_call`, etc. |
| **Lead Excel/CSV Upload** | ✅ Implemented | Multer upload, auto-mapping, UK phone normalization, batch import. |
| **Lead CRM Management** | ✅ Implemented | Filterable, searchable lead table with pagination. |
| **Campaign Manager** | 🟡 First Draft | CRUD, lead assignment, manual start/pause/stop, queue pacing loop. |
| **Campaign Calling Hours** | 🟡 First Draft | Stored on model; automatic clock-based restriction needs automated scheduling. |
| **Automated Retries / Recycling** | 🔴 Not Yet Implemented | Unanswered / busy leads are not yet automatically requeued on a timer. |
| **Real-Time Live Call Monitor** | ✅ Implemented | Socket.IO telemetry for live call state, transcripts, and duration. |
| **Call History & Transcripts** | ✅ Implemented | Full call logs, cost calculation, filter by disposition, transcript view. |
| **Analytics Funnels** | ✅ Implemented | Dialed $\rightarrow$ Answered $\rightarrow$ Qualified conversion funnel dashboard. |

---

## 15. Future Considerations (Explicitly NOT Implemented)

The following areas are **strictly outside current MVP scope** and are **NOT** present in the codebase:
- ❌ **Vector Databases & Embeddings**: No Pinecone, Qdrant, Weaviate, Milvus, Chroma, or MongoDB Vector Search.
- ❌ **Retrieval-Augmented Generation (RAG)**: No document chunking, semantic search, or LangChain RAG pipelines.
- ❌ **PBX / FreeSWITCH / Asterisk**: Pure cloud Twilio Media Streams $\leftrightarrow$ Node.js; no local PBX.
- ❌ **TPS Registry Scrubbing**: No automated integration with the UK Telephone Preference Service.
- ❌ **Multi-Lingual Voice Translation**: English (UK) voice agent only.

---

## 16. MVP Next Steps

To make the end-to-end client journey completely seamless from start to finish, the remaining engineering priorities are:

1. **Campaign Execution Hardening (Highest Priority)**:
   - Wire campaign start button to cleanly trigger queue processing for all assigned leads and update campaign counters in real-time.
2. **Calling Hours & Schedule Enforcement**:
   - Verify UK local time against `callingHoursStart` / `callingHoursEnd` before dispatching calls from the queue.
3. **Automated Call Retry Scheduling**:
   - Automatically requeue leads with `no-answer` or `busy` after a configurable delay (e.g. 2 hours, up to 3 attempts).
4. **End-to-End Live PSTN Dialing Verification**:
   - Run an automated campaign test dialing real test numbers to verify the complete loop from campaign start to qualified CRM lead.
