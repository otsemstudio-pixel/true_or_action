import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getSocket } from '../lib/socket.js';
import { useAuth } from './useAuth.jsx';

const RoomContext = createContext(null);

const initialState = {
  code: null,
  status: 'idle', // idle | waiting | playing | finished
  hostId: null,
  settings: null,
  players: [],
  turnNumber: 0,
  currentTurn: null,
  messages: [],
};

function snapshotToState(snapshot) {
  return {
    code: snapshot.code,
    status: snapshot.status,
    hostId: snapshot.hostId,
    settings: snapshot.settings,
    players: snapshot.players,
    turnNumber: snapshot.turnNumber,
    currentTurn: snapshot.currentTurn,
    messages: snapshot.messages ?? [],
  };
}

function emitWithAck(event, payload) {
  return new Promise((resolve, reject) => {
    const socket = getSocket();
    if (!socket) {
      reject(new Error('Non connecté au serveur'));
      return;
    }
    socket.timeout(8000).emit(event, payload, (err, response) => {
      if (err) {
        reject(new Error('Le serveur ne répond pas, réessayez'));
        return;
      }
      if (!response.ok) {
        reject(Object.assign(new Error(response.message), { code: response.code }));
        return;
      }
      resolve(response);
    });
  });
}

export function RoomProvider({ children }) {
  const { status: authStatus } = useAuth();
  const [room, setRoom] = useState(initialState);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;

    function onPlayers({ players, hostId }) {
      setRoom((prev) => (prev.status === 'idle' ? prev : { ...prev, players, hostId }));
    }
    function onSettings({ settings }) {
      setRoom((prev) => (prev.status === 'idle' ? prev : { ...prev, settings }));
    }
    function onGameStarted({ snapshot }) {
      setRoom(snapshotToState(snapshot));
    }

    socket.on('room:players', onPlayers);
    socket.on('room:settings', onSettings);
    socket.on('game:started', onGameStarted);

    return () => {
      socket.off('room:players', onPlayers);
      socket.off('room:settings', onSettings);
      socket.off('game:started', onGameStarted);
    };
  }, [authStatus]);

  const createRoom = useCallback(async (settings) => {
    const res = await emitWithAck('room:create', settings);
    setRoom(snapshotToState(res.snapshot));
    return res;
  }, []);

  const joinRoom = useCallback(async (code) => {
    const res = await emitWithAck('room:join', { code });
    setRoom(snapshotToState(res.snapshot));
    return res;
  }, []);

  const leaveRoom = useCallback(async () => {
    try {
      await emitWithAck('room:leave', {});
    } finally {
      setRoom(initialState);
    }
  }, []);

  const updateRoomSettings = useCallback(async (settings) => {
    const res = await emitWithAck('room:settings', settings);
    setRoom((prev) => ({ ...prev, settings: res.settings }));
    return res;
  }, []);

  const startGame = useCallback(() => emitWithAck('game:start', {}), []);

  return (
    <RoomContext.Provider
      value={{ room, createRoom, joinRoom, leaveRoom, updateRoomSettings, startGame }}
    >
      {children}
    </RoomContext.Provider>
  );
}

export function useRoom() {
  const ctx = useContext(RoomContext);
  if (!ctx) {
    throw new Error("useRoom doit être utilisé à l'intérieur de RoomProvider");
  }
  return ctx;
}
