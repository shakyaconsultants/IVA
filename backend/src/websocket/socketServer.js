const { Server } = require('socket.io');
const twilioService = require('../services/twilioService');

function initSocketServer(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST']
    }
  });

  // Inject Socket.io into services
  twilioService.setSocketIO(io);

  io.on('connection', (socket) => {
    console.log(`[WebSocket] Client connected: ${socket.id}`);

    socket.on('call:transfer_manual', async ({ callId, targetNumber }) => {
      try {
        await twilioService.transferCall(callId, targetNumber, 'Manual UI Hotkey');
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    socket.on('call:hangup_manual', async ({ callId }) => {
      try {
        await twilioService.hangupCall(callId, 'Manual Agent Hangup');
      } catch (err) {
        socket.emit('error', { message: err.message });
      }
    });

    socket.on('disconnect', () => {
      console.log(`[WebSocket] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

module.exports = initSocketServer;
