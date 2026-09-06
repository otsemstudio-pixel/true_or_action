import { useEffect, useState } from 'react';
import { getSocket } from '../lib/socket.js';

// Au-delà de ce délai d'échecs ininterrompus, on ne parle plus d'une simple
// coupure passagère (celle-là, socket.io la rattrape tout seul en quelques
// tentatives) mais d'un réseau qui bloque durablement les WebSocket (proxy
// d'entreprise, pare-feu restrictif) — la reconnexion automatique ne s'en
// sortira jamais seule, donc autant le dire au joueur plutôt que le laisser
// devant un "Reconnexion…" indéfini.
const BLOCKED_AFTER_MS = 12000;

function computeStatus(socket) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  return socket?.connected ? 'connected' : 'reconnecting';
}

export function useSocketStatus() {
  const [status, setStatus] = useState(() => computeStatus(getSocket()));

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;

    let blockedTimer = null;

    const clearBlockedTimer = () => {
      if (blockedTimer) {
        clearTimeout(blockedTimer);
        blockedTimer = null;
      }
    };

    const refresh = () => {
      clearBlockedTimer();
      setStatus(computeStatus(socket));
    };

    // Ne démarre le chronomètre qu'au premier échec d'une série : chaque
    // nouvelle tentative de socket.io émet son propre connect_error, mais
    // c'est la durée totale sans succès qui nous intéresse, pas le nombre de
    // tentatives.
    const handleConnectError = () => {
      if (blockedTimer) return;
      blockedTimer = setTimeout(() => {
        if (!socket.connected) setStatus('blocked');
      }, BLOCKED_AFTER_MS);
    };

    socket.on('connect', refresh);
    socket.on('disconnect', refresh);
    socket.on('connect_error', handleConnectError);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);

    refresh();

    return () => {
      clearBlockedTimer();
      socket.off('connect', refresh);
      socket.off('disconnect', refresh);
      socket.off('connect_error', handleConnectError);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
    };
  }, []);

  return status;
}
