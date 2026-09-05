import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { registerSocketHandlers } from './sockets/index.js';

const app = express();

app.use(cors({ origin: env.clientOrigin }));
app.use(express.json());

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'ok' });
  } catch (err) {
    console.error('Healthcheck DB échoué:', err.code || err.name || 'erreur inconnue');
    res.status(503).json({ status: 'degraded', db: 'error' });
  }
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: env.clientOrigin },
});

registerSocketHandlers(io);

httpServer.listen(env.port, () => {
  console.log(`Serveur démarré sur le port ${env.port} (${env.nodeEnv})`);
});
