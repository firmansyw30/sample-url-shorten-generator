import { customAlphabet } from 'nanoid';
import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import redis from 'redis';

const app = express();
app.use(express.json());

const redisClients = [
  redis.createClient({ url: `redis://${process.env.REDIS_HOST_1}:${process.env.REDIS_PORT_1}` }),
  redis.createClient({ url: `redis://${process.env.REDIS_HOST_2}:${process.env.REDIS_PORT_2}` }),
  redis.createClient({ url: `redis://${process.env.REDIS_HOST_3}:${process.env.REDIS_PORT_3}` })
];

// Hash function to distribute keys among Redis clients
function getRedisClient(key) {
  const hash = key.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return redisClients[hash % redisClients.length];
}

// Connect all Redis clients parallely
async function connectRedisClients() {
  const connectionPromises = redisClients.map(async (client, index) => {
    try {
      await client.connect();
      console.log(`Redis client ${index + 1} connected successfully`);
    } catch (error) {
      console.error(`Error connecting to Redis client ${index + 1}:`, error);
    }
  });
  await Promise.all(connectionPromises);
}

// Endpoint to shorten a URL with expiration
app.post('/shorten', async (req, res) => {
  const { url, ttl } = req.body; // ttl (time-to-live) is optional
  if (!url) return res.status(400).send('URL is required');

  const shortId = customAlphabet('0123456789abcdef', 5)(); // Generate a 5-character hex ID
  console.log(`Generated short ID: ${shortId} for URL: ${url}`);
  const redisClient = getRedisClient(shortId);

  try {
    const ttlSeconds = ttl ? parseInt(ttl) : 3600;
    await redisClient.set(shortId, url, { EX: ttlSeconds });
    res.json ({ shortUrl: `http://localhost:${process.env.PORT}/${shortId}` });
  } catch (error) {
    console.error('Error occurred while shortening URL:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Endpoint to retrieve the original URL
app.get('/:shortId', async (req, res) => {
  const { shortId } = req.params;
  const redisClient = getRedisClient(shortId);

  try {
    const url = await redisClient.get(shortId);
    if (!url) {
      console.log(`Cache miss for key: ${shortId}`);
      return res.status(404).send('URL not found');
    }
    console.log(`Cache hit for key: ${shortId}`);
    res.redirect(url);
  } catch (error) {
    console.error('Error occurred while retrieving URL:', error);
    res.status(500).send('Internal Server Error');
  }
});

// Start the server after connecting to Redis clients
async function startServer() {
  await connectRedisClients();
  app.listen(process.env.PORT, () => {
    console.log(`Server running on port ${process.env.PORT}`);
  });
}
startServer();
