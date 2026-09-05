import { useEffect, useState } from 'react';
import { getSocket } from '../lib/socket.js';

function computeStatus(socket) {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline';
  return socket?.connected ? 'connected' : 'reconnecting';
}

export function useSocketStatus() {
  const [status, setStatus] = useState(() => computeStatus(getSocket()));

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;

    const refresh = () => setStatus(computeStatus(socket));

    socket.on('connect', refresh);
    socket.on('disconnect', refresh);
    window.addEventListener('online', refresh);
    window.addEventListener('offline', refresh);

    refresh();

    return () => {
      socket.off('connect', refresh);
      socket.off('disconnect', refresh);
      window.removeEventListener('online', refresh);
      window.removeEventListener('offline', refresh);
    };
  }, []);

  return status;
}
