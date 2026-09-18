const mongoose = require('mongoose');
const dns = require('dns');

let isConnected = false;
let currentUri = '';

const connectDB = async (customUri) => {
  const uri = customUri || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/iva_cc_db';
  currentUri = uri;

  try {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }

    const isAtlas = uri.includes('mongodb+srv') || uri.includes('.net');
    console.log(`[MongoDB] Attempting connection to ${isAtlas ? 'MongoDB Atlas' : 'Local MongoDB'}...`);

    if (isAtlas) {
      const dnsServers = (process.env.MONGODB_DNS_SERVERS || '1.1.1.1,8.8.8.8')
        .split(',')
        .map((server) => server.trim())
        .filter(Boolean);
      dns.setServers(dnsServers);
    }

    const conn = await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 8000
    });

    isConnected = true;
    console.log(`[MongoDB] Connected successfully to ${isAtlas ? 'MongoDB Atlas' : 'Local MongoDB'}: ${conn.connection.host}/${conn.connection.name}`);
    return { success: true, host: conn.connection.host, db: conn.connection.name, isAtlas };
  } catch (error) {
    isConnected = false;
    console.error(`[MongoDB] Connection Error: ${error.message}`);
    return { success: false, error: error.message };
  }
};

const getDbStatus = () => {
  const isAtlas = currentUri.includes('mongodb+srv') || currentUri.includes('.net');
  // Mask password for display
  const maskedUri = currentUri ? currentUri.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:••••••••@') : '';
  return {
    connected: mongoose.connection.readyState === 1,
    isAtlas,
    host: mongoose.connection.host || '',
    dbName: mongoose.connection.name || 'iva_cc_db',
    maskedUri
  };
};

module.exports = { connectDB, getDbStatus };
