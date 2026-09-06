import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { env } from './config/env.js';
import { pool } from './db/pool.js';
import { registerSocketHandlers, reloadActiveRooms } from './sockets/index.js';
import authRouter from './routes/auth.js';
import { deleteInactiveGuests } from './auth/repository.js';

// Filet de dernier recours : sans lui, la moindre promesse rejetée sans
// gestionnaire (ou exception échappée d'un code non couvert par un
// try/catch) termine tout le process Node — coupant TOUTES les parties en
// cours pour TOUS les joueurs, pas seulement la connexion à l'origine du
// problème. Chaque salon vit dans son propre état isolé (voir sockets/store.js) :
// mieux vaut journaliser bruyamment et laisser tourner le reste des parties
// que de garantir une coupure totale à chaque bug non anticipé. Ce choix
// (continuer plutôt que sortir) ne remplace pas la correction des causes —
// c'est une protection en profondeur, pas une excuse pour ne pas corriger.
process.on('unhandledRejection', (reason) => {
  console.error(
    'Rejet de promesse non intercepté (le process continue) :',
    reason instanceof Error ? reason.stack : reason
  );
});

process.on('uncaughtException', (err) => {
  console.error('Exception non interceptée (le process continue) :', err instanceof Error ? err.stack : err);
});

const app = express();

app.use(cors({ origin: env.clientOrigins }));
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
  cors: { origin: env.clientOrigins },
  // Sans sessions collantes configurées devant plusieurs instances, les
  // requêtes HTTP successives du transport "polling" peuvent atterrir sur
  // des instances différentes et rompre le handshake — ce qui remonte côté
  // navigateur comme des erreurs CORS ou des coupures WebSocket trompeuses.
  // Le WebSocket seul n'a besoin que d'une connexion persistante unique,
  // donc aucune affinité de session à maintenir entre plusieurs requêtes.
  transports: ['websocket'],
});

registerSocketHandlers(io);

async function start() {
  try {
    await reloadActiveRooms(io);
  } catch (err) {
    console.error('Échec du rechargement des parties en cours:', err.code || err.name || 'erreur inconnue');
  }

  // Comptes invités inactifs depuis 90 jours : voir auth/repository.js pour
  // le détail des colonnes nullifiées vs supprimées (jamais de suppression
  // en cascade des tours).
  try {
    const deleted = await deleteInactiveGuests(pool);
    if (deleted > 0) {
      console.log(`${deleted} compte(s) invité(s) inactif(s) supprimé(s)`);
    }
  } catch (err) {
    console.error('Échec du nettoyage des comptes invités inactifs:', err.code || err.name || 'erreur inconnue');
  }

  httpServer.listen(env.port, () => {
    console.log(`Serveur démarré sur le port ${env.port} (${env.nodeEnv})`);
  });
}

start();
