const Redis = require('ioredis');

const redisConfig = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: parseInt(process.env.REDIS_PORT, 10) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
  retryStrategy(times) {
    if (times > 3) {
      return null; // Stop retrying after 3 attempts if offline
    }
    return Math.min(times * 200, 2000);
  }
};

let redisClient = null;
let isRedisAvailable = false;

try {
  redisClient = new Redis(redisConfig);

  redisClient.on('connect', () => {
    isRedisAvailable = true;
    console.log(`[Redis] Connected to Redis at ${redisConfig.host}:${redisConfig.port}`);
  });

  redisClient.on('error', (err) => {
    isRedisAvailable = false;
    // Log once without spamming console
    if (err.code === 'ECONNREFUSED') {
      console.warn(`[Redis] Notice: Redis not reachable on ${redisConfig.host}:${redisConfig.port}. Using Local Memory Queue fallback for Option B.`);
    } else {
      console.warn(`[Redis] Error: ${err.message}`);
    }
  });
} catch (err) {
  console.warn(`[Redis] Initialization warning: ${err.message}`);
}

module.exports = {
  redisClient,
  redisConfig,
  getIsRedisAvailable: () => isRedisAvailable
};
