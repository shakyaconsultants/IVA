require('dotenv').config();
const http = require('http');
const express = require('express');
const cors = require('cors');
const { connectDB } = require('./config/db');
const initSocketServer = require('./websocket/socketServer');
const initTwilioMediaStream = require('./services/twilioMediaStream');
const { initQueues } = require('./queues/queueManager');
const { setSocketIO: setTwilioSocketIO } = require('./services/twilioService');

// Express App
const app = express();
const httpServer = http.createServer(app);

// Middleware
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true }));

// Initialize WebSocket Server
const io = initSocketServer(httpServer);
initTwilioMediaStream(httpServer, io);

// Wire service references after the Socket.IO server exists
setTwilioSocketIO(io);

// API Routes
app.use('/api/auth', require('./routes/authRoutes'));
app.use('/api/leads', require('./routes/leadRoutes'));
app.use('/api/campaigns', require('./routes/campaignRoutes'));
app.use('/api/calls', require('./routes/callRoutes'));
app.use('/api/ai', require('./routes/aiRoutes'));
app.use('/api/transfers', require('./routes/transferRoutes'));
app.use('/api/analytics', require('./routes/analyticsRoutes'));
app.use('/api/settings', require('./routes/settingsRoutes'));
app.use('/api/webhooks', require('./routes/webhookRoutes'));

// Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date(),
    service: 'UK IVA Cold Calling & CRM Platform',
    callingProvider: 'twilio'
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(`[Server Error] ${err.stack}`);
  res.status(500).json({ message: err.message || 'Internal Server Error' });
});

const PORT = process.env.PORT || 5000;

async function startServer() {
  // Connect MongoDB
  await connectDB();

  // Initialize BullMQ / local queues
  initQueues();

  httpServer.listen(PORT, () => {
    console.log(`=======================================================`);
    console.log(`🚀 IVA Cold Calling API & WebSocket running on port ${PORT}`);
    console.log(`📞 Calling Provider: Twilio Voice`);
    console.log(`=======================================================`);
  });
}

startServer();
