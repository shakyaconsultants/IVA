const { WebSocketServer } = require('ws');

function initTwilioMediaStream(httpServer, socketIO) {
  const webSocketServer = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url, 'http://localhost');
    if (!requestUrl.pathname.startsWith('/api/webhooks/twilio/media/')) return;

    const callId = decodeURIComponent(requestUrl.pathname.split('/').pop());
    webSocketServer.handleUpgrade(request, socket, head, (client) => {
      client.callId = callId;
      webSocketServer.emit('connection', client, request);
    });
  });

  webSocketServer.on('connection', (client) => {
    client.on('message', (message) => {
      try {
        const event = JSON.parse(message.toString());
        if (event.event === 'media' && event.media?.payload) {
          socketIO.emit('call:audio', {
            callId: client.callId,
            payload: event.media.payload
          });
        }
      } catch (error) {
        console.warn(`[Twilio Media] Invalid stream event: ${error.message}`);
      }
    });

    client.on('error', (error) => {
      console.warn(`[Twilio Media] Stream error: ${error.message}`);
    });
  });
}

module.exports = initTwilioMediaStream;
