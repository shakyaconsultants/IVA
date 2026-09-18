# UK IVA Cold Calling & Lead Qualification CRM Platform

An enterprise outbound AI cold calling platform and CRM tailored for UK IVA (Individual Voluntary Arrangement) debt relief qualification. Built with **Asterisk PBX**, **Twilio Elastic SIP Trunking**, **OpenAI Realtime Voice API**, **Node.js (Express & Socket.io)**, **BullMQ / Redis**, **MongoDB**, and a modern **React Dashboard**.

---

## Architecture Overview

```
                 ┌─────────────────────────────────┐
                 │    React Frontend (Port 5173)   │
                 │   Dashboard / CRM / Live Calls  │
                 └────────────────┬────────────────┘
                                  │ REST / WebSocket (Socket.io)
                                  ▼
                 ┌─────────────────────────────────┐
                 │     Node.js API (Port 5000)     │
                 │   Auth / Campaigns / Pacer CRM  │
                 └────────┬───────┬───────┬────────┘
                          │       │       │
              ┌───────────┘       │       └───────────┐
              ▼                   ▼                   ▼
       ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
       │   MongoDB    │    │  AudioSocket │    │  BullMQ /    │
       │ Leads & Calls│    │   TCP 9092   │    │  Redis Queue │
       └──────────────┘    └──────┬───────┘    └──────────────┘
                                  │
                                  ▼
                         ┌─────────────────┐
                         │   Asterisk PBX  │
                         │   (PJSIP + AMD) │
                         └────────┬────────┘
                                  │ SIP / RTP
                                  ▼
                         ┌─────────────────┐
                         │   Twilio SIP    │
                         │      Trunk      │
                         └────────┬────────┘
                                  │ PSTN
                                  ▼
                            UK Prospect (+44)
                                  ▲
                                  │ PCM Audio Stream
                                  ▼
                         ┌─────────────────┐
                         │ OpenAI Realtime │
                         │ Voice Agent     │
                         └─────────────────┘
```

---

## 10 Core CRM Screens Included

1. **Login & Auth**: Clean authentication with operator session persistence and password reset.
2. **Dashboard**: Live KPIs: Total Leads, Calls Today, Answered, Voicemail (AMD), Interested, Transferred, Conversion %, Minutes Used, Cost in GBP (£), and active campaign toggles.
3. **Upload Leads**: 5-step wizard (Upload Excel/CSV -> Auto Column Mapping -> Validation -> Duplicate Check -> Campaign Import).
4. **Campaigns**: Configure Campaign Name, Caller ID (+44), UK Calling Hours, Max CPS (Calls/Sec), Concurrency limits, AI Persona, and Transfer Number.
5. **AI Voice Agent**: Configure Company Name, Agent Name, Opening Script, Debt Questions, Qualification Rules (>£5k debt, 2+ creditors), Warm Transfer Script, Voicemail Message, and Interactive AI Dialogue Sandbox.
6. **Live Calls Monitor**: Real-time Asterisk active lines monitor with duration timer, AMD badge (Human vs Voicemail), streaming live conversation transcript, audio waveform, and Hotkey Transfer button.
7. **Call History**: Multi-parameter filter (Date, Campaign, Disposition, Interested, Transferred), call duration, cost breakdown, and inspection modal with full transcripts.
8. **Lead Management**: Full CRM table with search, contact status, attempts count, debt amounts, postcodes, and manual one-click dial button.
9. **Analytics**: Visual outbound conversion funnel (Dialed -> Answered -> Human -> Qualified -> Transferred), cost per lead, and cost per transfer.
10. **Settings**: Twilio Elastic SIP Trunking credentials, Asterisk ARI/AudioSocket endpoints, OpenAI API key and voice model configuration, transfer target numbers, webhook URLs, and operator user management.

---

## Quick Start (Option B: Local Windows Development)

### 1. Prerequisites
- **Node.js** (v18+ or v25+)
- **MongoDB** (running on `127.0.0.1:27017`)

### 2. Start Backend
```powershell
cd backend
npm start
```
*API runs on `http://localhost:5000` with WebSocket support.*

### 3. Start Frontend
```powershell
cd frontend
npm run dev
```
*Vite UI opens on `http://localhost:5173`.*

### Default Login Credentials:
- **Email**: `admin@ivacc.co.uk`
- **Password**: `password123`

---

## Production Asterisk PBX Deployment (Option A)

For live telecommunications with Twilio SIP Trunking:
1. Deploy a Linux Ubuntu 22.04 / 24.04 VPS (e.g. AWS EC2 or Hetzner).
2. Run the included setup script:
   ```bash
   cd asterisk
   chmod +x install-asterisk.sh
   sudo ./install-asterisk.sh
   ```
3. Or build the Docker container:
   ```bash
   cd asterisk
   docker build -t iva-asterisk .
   docker run -d --net=host --name iva-asterisk iva-asterisk
   ```
4. Configure your public IP and Twilio Trunk credentials in `/etc/asterisk/pjsip.conf`.
