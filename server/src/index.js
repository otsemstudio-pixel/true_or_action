import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { registerSocketHandlers, reloadActiveRooms } from './sockets/index.js';
import authRouter from './routes/auth.js';

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

app.use('/api/auth', authRouter);

app.use((err, req, res, next) => {
  if (err.name === 'AuthError') {
    return res.status(err.status || 400).json({ code: err.code, message: err.message, details: err.details });
  }
  console.error('Erreur HTTP inattendue:', err.code || err.name || 'erreur inconnue');
  res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Erreur interne' });
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: { origin: env.clientOrigin },
});

registerSocketHandlers(io);

async function start() {
  try {
    await reloadActiveRooms(io);
  } catch (err) {
    console.error('Échec du rechargement des parties en cours:', err.code || err.name || 'erreur inconnue');
  }

  httpServer.listen(env.port, () => {
    console.log(`Serveur démarré sur le port ${env.port} (${env.nodeEnv})`);
  });
}

start();
