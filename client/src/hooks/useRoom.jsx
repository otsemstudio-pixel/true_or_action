import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { getSocket } from '../lib/socket.js';
import { useAuth } from './useAuth.jsx';

const RoomContext = createContext(null);

const initialState = {
  code: null,
  status: 'idle', // idle | waiting | playing | finished
  hostId: null,
  settings: null,
  niveauMax: 1,
  langue: 'fr',
  players: [],
  turnNumber: 0,
  currentTurn: null,
  messages: [],
  lastResult: null,
  ranking: null,
};

function snapshotToState(snapshot) {
  return {
    code: snapshot.code,
    status: snapshot.status,
    hostId: snapshot.hostId,
    settings: snapshot.settings,
    niveauMax: snapshot.niveauMax,
    langue: snapshot.langue ?? 'fr',
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
      reject(Object.assign(new Error('Non connecté au serveur'), { code: 'SOCKET_NOT_CONNECTED' }));
      return;
    }
    socket.timeout(8000).emit(event, payload, (err, response) => {
      if (err) {
        reject(Object.assign(new Error('Le serveur ne répond pas, réessayez'), { code: 'SOCKET_TIMEOUT' }));
        return;
      }
      if (!response.ok) {
        reject(Object.assign(new Error(response.message), { code: response.code, details: response.details }));
        return;
      }
      resolve(response);
    });
  });
}

export function RoomProvider({ children }) {
  const { status: authStatus } = useAuth();
  const [room, setRoom] = useState(initialState);
  const roomCodeRef = useRef(null);

  useEffect(() => {
    roomCodeRef.current = room.code;
  }, [room.code]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return undefined;

    // Le transport peut se reconnecter à tout moment (3G instable) ; si on était
    // dans un salon, on redemande aussitôt un snapshot complet au lieu d'attendre
    // une action de l'utilisateur.
    function onConnect() {
      if (!roomCodeRef.current) return;
      emitWithAck('room:rejoin', { code: roomCodeRef.current })
        .then((res) => setRoom(snapshotToState(res.snapshot)))
        .catch(() => setRoom(initialState));
    }

    function onPlayers({ players, hostId }) {
      setRoom((prev) => (prev.status === 'idle' ? prev : { ...prev, players, hostId }));
    }
    function onSettings({ settings }) {
      setRoom((prev) => (prev.status === 'idle' ? prev : { ...prev, settings }));
    }
    function onNiveau({ niveauMax }) {
      setRoom((prev) => (prev.status === 'idle' ? prev : { ...prev, niveauMax }));
    }
    function onLangue({ langue }) {
      setRoom((prev) => (prev.status === 'idle' ? prev : { ...prev, langue }));
    }
    function onGameStarted({ snapshot }) {
      setRoom(snapshotToState(snapshot));
    }
    function onGameRestarted({ snapshot }) {
      setRoom({ ...snapshotToState(snapshot), lastResult: null, ranking: null });
    }
    function onTurnStarted(payload) {
      setRoom((prev) => ({
        ...prev,
        turnNumber: payload.turnNumber,
        currentTurn: {
          turnNumber: payload.turnNumber,
          activePlayerId: payload.activePlayerId,
          type: payload.type,
          questionId: payload.questionId,
          contenu: payload.contenu,
          phase: 'answering',
          answer: null,
          votes: {},
          answerDeadline: payload.answerDeadline,
          voteDeadline: null,
        },
      }));
    }
    function onTurnAnswered(payload) {
      setRoom((prev) => {
        if (!prev.currentTurn || prev.currentTurn.turnNumber !== payload.turnNumber) return prev;
        return {
          ...prev,
          currentTurn: {
            ...prev.currentTurn,
            phase: 'voting',
            answer: payload.answer,
            voteDeadline: payload.voteDeadline,
          },
        };
      });
    }
    function onTurnVoted(payload) {
      setRoom((prev) => {
        if (!prev.currentTurn || prev.currentTurn.turnNumber !== payload.turnNumber) return prev;
        return {
          ...prev,
          currentTurn: {
            ...prev.currentTurn,
            votes: { ...prev.currentTurn.votes, [payload.voterId]: true },
          },
        };
      });
    }
    function onTurnResolved(payload) {
      setRoom((prev) => ({
        ...prev,
        players: payload.players,
        lastResult: {
          turnNumber: payload.turnNumber,
          playerId: payload.playerId,
          points: payload.points,
          votes: payload.votes,
        },
        currentTurn:
          prev.currentTurn && prev.currentTurn.turnNumber === payload.turnNumber
            ? { ...prev.currentTurn, phase: 'resolved' }
            : prev.currentTurn,
      }));
    }
    function onGameEnded(payload) {
      setRoom((prev) => ({ ...prev, status: 'finished', ranking: payload.ranking, currentTurn: null }));
    }
    function onChatNew(message) {
      setRoom((prev) => ({ ...prev, messages: [...prev.messages, message].slice(-200) }));
    }

    socket.on('connect', onConnect);
    socket.on('room:players', onPlayers);
    socket.on('room:settings', onSettings);
    socket.on('room:niveau', onNiveau);
    socket.on('room:langue', onLangue);
    socket.on('game:started', onGameStarted);
    socket.on('game:restarted', onGameRestarted);
    socket.on('turn:started', onTurnStarted);
    socket.on('turn:answered', onTurnAnswered);
    socket.on('turn:voted', onTurnVoted);
    socket.on('turn:resolved', onTurnResolved);
    socket.on('game:ended', onGameEnded);
    socket.on('chat:new', onChatNew);

    return () => {
      socket.off('connect', onConnect);
      socket.off('room:players', onPlayers);
      socket.off('room:settings', onSettings);
      socket.off('room:niveau', onNiveau);
      socket.off('room:langue', onLangue);
      socket.off('game:started', onGameStarted);
      socket.off('game:restarted', onGameRestarted);
      socket.off('turn:started', onTurnStarted);
      socket.off('turn:answered', onTurnAnswered);
      socket.off('turn:voted', onTurnVoted);
      socket.off('turn:resolved', onTurnResolved);
      socket.off('game:ended', onGameEnded);
      socket.off('chat:new', onChatNew);
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

  const updateNiveauMax = useCallback(async (niveauMax) => {
    const res = await emitWithAck('room:niveau', { niveauMax });
    setRoom((prev) => ({ ...prev, niveauMax: res.niveauMax }));
    return res;
  }, []);

  const updateRoomLangue = useCallback(async (langue) => {
    const res = await emitWithAck('room:langue', { langue });
    setRoom((prev) => ({ ...prev, langue: res.langue }));
    return res;
  }, []);

  const startGame = useCallback(() => emitWithAck('game:start', {}), []);

  const restartGame = useCallback(() => emitWithAck('game:rematch', {}), []);

  const sendAnswer = useCallback((text) => emitWithAck('turn:answer', { text }), []);

  const sendVote = useCallback((vote) => emitWithAck('turn:vote', { vote }), []);

  const sendChat = useCallback((text, clientId) => emitWithAck('chat:send', { text, clientId }), []);

  return (
    <RoomContext.Provider
      value={{
        room,
        createRoom,
        joinRoom,
        leaveRoom,
        updateRoomSettings,
        updateNiveauMax,
        updateRoomLangue,
        startGame,
        restartGame,
        sendAnswer,
        sendVote,
        sendChat,
      }}
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
