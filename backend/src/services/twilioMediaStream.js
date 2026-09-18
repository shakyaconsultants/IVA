const { WebSocketServer } = require('ws');
const voiceGateway = require('../voice/voiceGateway');

function initTwilioMediaStream(httpServer, socketIO) {
  const webSocketServer = new WebSocketServer({ noServer: true });

  // Connect socket.io into voice gateway for real-time CRM updates
  if (socketIO) {
    voiceGateway.setSocketIO(socketIO);
  }

  httpServer.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url, 'http://localhost');
    if (!requestUrl.pathname.startsWith('/api/webhooks/twilio/media/')) return;

    const callId = decodeURIComponent(requestUrl.pathname.split('/').pop());
    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      client.callId = callId;
      webSocketServer.emit('connection', client, request);
    });
  });

  webSocketServer.on('connection', (client, request) => {
    voiceGateway.handleTwilioConnection(client, request);
  });
}

module.exports = initTwilioMediaStream;
