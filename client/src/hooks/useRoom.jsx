import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { getSocket } from '../lib/socket.js';
import { useAuth } from './useAuth.jsx';

const RoomContext = createContext(null);

const DEFAULT_REGLES = {
  refusCouteux: false,
  doubleOuRien: false,
  questionRetournee: false,
  tourSurprise: false,
  pariMutuel: false,
};

const initialState = {
  code: null,
  status: 'idle', // idle | waiting | playing | finished
  hostId: null,
  settings: null,
  niveauMax: 1,
  langue: 'fr',
  regles: DEFAULT_REGLES,
  partieId: null,
  players: [],
  turnNumber: 0,
  currentTurn: null,
  messages: [],
  lastResult: null,
  ranking: null,
};

// Un bloc de réponse publié automatiquement est un message comme un autre
// (voir persistence.js côté serveur, turn_id le distingue via `turnInfo`) :
// le snapshot les transporte déjà dans `messages`, aucun état séparé à
// reconstruire ici, ni pour le tour en cours ni pour l'historique.
function snapshotToState(snapshot) {
  return {
    code: snapshot.code,
    status: snapshot.status,
    hostId: snapshot.hostId,
    settings: snapshot.settings,
    niveauMax: snapshot.niveauMax,
    langue: snapshot.langue ?? 'fr',
    regles: snapshot.regles ?? DEFAULT_REGLES,
    partieId: snapshot.partieId ?? null,
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

// Construit l'état "currentTurn" côté client à partir d'un turn:started —
// deux formes distinctes selon le mode, pour éviter des champs à moitié
// pertinents dans un sens comme dans l'autre.
function currentTurnFromStarted(payload) {
  if (payload.mode === 'surprise') {
    return {
      mode: 'surprise',
      turnNumber: payload.turnNumber,
      activePlayerIds: payload.activePlayerIds,
      type: payload.type,
      questionId: payload.questionId,
      contenu: payload.contenu,
      phase: 'answering',
      answeredPlayerIds: [],
      answers: null,
      votes: {},
      answerDeadline: payload.answerDeadline,
      voteDeadline: null,
    };
  }
  return {
    mode: 'normal',
    turnNumber: payload.turnNumber,
    activePlayerId: payload.activePlayerId,
    type: payload.type,
    questionId: payload.questionId,
    contenu: payload.contenu,
    phase: 'answering',
    answer: null,
    votes: {},
    doubleOuRien: Boolean(payload.doubleOuRien),
    returned: false,
    originalPlayerId: null,
    pariMutuel: null,
    choices: null,
    answerDeadline: payload.answerDeadline,
    voteDeadline: null,
    niveauChoiceDeadline: null,
    questionChoiceDeadline: null,
    jugementDeadline: null,
  };
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
    function onRegles({ regles }) {
      setRoom((prev) => (prev.status === 'idle' ? prev : { ...prev, regles }));
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
        currentTurn: currentTurnFromStarted(payload),
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
      if (payload.mode === 'surprise') {
        setRoom((prev) => ({
          ...prev,
          players: payload.players,
          lastResult: {
            turnNumber: payload.turnNumber,
            mode: 'surprise',
            results: payload.results,
            winnerIds: payload.winnerIds,
          },
          currentTurn:
            prev.currentTurn && prev.currentTurn.turnNumber === payload.turnNumber
              ? { ...prev.currentTurn, phase: 'resolved' }
              : prev.currentTurn,
        }));
        return;
      }
      setRoom((prev) => {
        // Un timeout ne produit jamais de message (rien n'a été répondu) :
        // seuls les messages déjà marqués pour ce tour sont mis à jour.
        const thumbsUp = Object.values(payload.votes).filter((v) => v === 'up').length;
        const messages = prev.messages.map((m) =>
          m.turnInfo?.turnNumber === payload.turnNumber
            ? { ...m, turnInfo: { ...m.turnInfo, points: payload.points, resolved: true, thumbsUp } }
            : m
        );
        return {
          ...prev,
          players: payload.players,
          lastResult: {
            turnNumber: payload.turnNumber,
            mode: 'normal',
            playerId: payload.playerId,
            points: payload.points,
            votes: payload.votes,
            pariMutuel: payload.pariMutuel ?? null,
          },
          currentTurn:
            prev.currentTurn && prev.currentTurn.turnNumber === payload.turnNumber
              ? { ...prev.currentTurn, phase: 'resolved' }
              : prev.currentTurn,
          messages,
        };
      });
    }
    function onTurnPassed(payload) {
      setRoom((prev) => ({
        ...prev,
        players: payload.players,
        lastResult: { turnNumber: payload.turnNumber, mode: 'refus', playerId: payload.playerId, points: payload.points },
        currentTurn:
          prev.currentTurn && prev.currentTurn.turnNumber === payload.turnNumber
            ? { ...prev.currentTurn, phase: 'resolved' }
            : prev.currentTurn,
      }));
    }
    function onQuestionChoiceOffered(payload) {
      setRoom((prev) => ({
        ...prev,
        turnNumber: payload.turnNumber,
        currentTurn: {
          mode: 'normal',
          turnNumber: payload.turnNumber,
          activePlayerId: payload.activePlayerId,
          type: null,
          questionId: null,
          contenu: null,
          phase: 'question_choice',
          answer: null,
          votes: {},
          doubleOuRien: false,
          returned: false,
          originalPlayerId: null,
          pariMutuel: null,
          choices: payload.choices,
          answerDeadline: null,
          voteDeadline: null,
          niveauChoiceDeadline: null,
          questionChoiceDeadline: payload.deadline,
          jugementDeadline: null,
        },
      }));
    }
    function onNiveauChoiceOffered(payload) {
      setRoom((prev) => ({
        ...prev,
        turnNumber: payload.turnNumber,
        currentTurn: {
          mode: 'normal',
          turnNumber: payload.turnNumber,
          activePlayerId: payload.activePlayerId,
          type: null,
          questionId: null,
          contenu: null,
          phase: 'niveau_choice',
          answer: null,
          votes: {},
          doubleOuRien: false,
          returned: false,
          originalPlayerId: null,
          pariMutuel: null,
          choices: null,
          answerDeadline: null,
          voteDeadline: null,
          niveauChoiceDeadline: payload.deadline,
          questionChoiceDeadline: null,
          jugementDeadline: null,
        },
      }));
    }
    function onQuestionReturned(payload) {
      setRoom((prev) => {
        if (!prev.currentTurn || prev.currentTurn.turnNumber !== payload.turnNumber) return prev;
        return {
          ...prev,
          currentTurn: {
            ...prev.currentTurn,
            activePlayerId: payload.toPlayerId,
            returned: true,
            originalPlayerId: payload.fromPlayerId,
          },
        };
      });
    }
    function onJugementStarted(payload) {
      setRoom((prev) => {
        if (!prev.currentTurn || prev.currentTurn.turnNumber !== payload.turnNumber) return prev;
        return {
          ...prev,
          currentTurn: {
            ...prev.currentTurn,
            phase: 'jugement',
            pariMutuel: { bettorId: payload.bettorId, bet: payload.bet, verdict: null },
            jugementDeadline: payload.deadline,
          },
        };
      });
    }
    function onSurpriseAnswered(payload) {
      setRoom((prev) => {
        if (!prev.currentTurn || prev.currentTurn.turnNumber !== payload.turnNumber) return prev;
        return {
          ...prev,
          currentTurn: {
            ...prev.currentTurn,
            answeredPlayerIds: [...new Set([...prev.currentTurn.answeredPlayerIds, payload.playerId])],
          },
        };
      });
    }
    function onSurpriseVotingStarted(payload) {
      setRoom((prev) => {
        if (!prev.currentTurn || prev.currentTurn.turnNumber !== payload.turnNumber) return prev;
        return {
          ...prev,
          currentTurn: {
            ...prev.currentTurn,
            phase: 'voting',
            answers: payload.answers,
            votes: {},
            voteDeadline: payload.voteDeadline,
          },
        };
      });
    }
    function onSurpriseVoted(payload) {
      setRoom((prev) => {
        if (!prev.currentTurn || prev.currentTurn.turnNumber !== payload.turnNumber) return prev;
        return {
          ...prev,
          currentTurn: { ...prev.currentTurn, votes: { ...prev.currentTurn.votes, [payload.voterId]: true } },
        };
      });
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
    socket.on('room:regles', onRegles);
    socket.on('game:started', onGameStarted);
    socket.on('game:restarted', onGameRestarted);
    socket.on('turn:started', onTurnStarted);
    socket.on('turn:answered', onTurnAnswered);
    socket.on('turn:voted', onTurnVoted);
    socket.on('turn:resolved', onTurnResolved);
    socket.on('turn:passed', onTurnPassed);
    socket.on('turn:questionChoiceOffered', onQuestionChoiceOffered);
    socket.on('turn:niveauChoiceOffered', onNiveauChoiceOffered);
    socket.on('turn:questionReturned', onQuestionReturned);
    socket.on('turn:jugementStarted', onJugementStarted);
    socket.on('turn:surpriseAnswered', onSurpriseAnswered);
    socket.on('turn:surpriseVotingStarted', onSurpriseVotingStarted);
    socket.on('turn:surpriseVoted', onSurpriseVoted);
    socket.on('game:ended', onGameEnded);
    socket.on('chat:new', onChatNew);

    return () => {
      socket.off('connect', onConnect);
      socket.off('room:players', onPlayers);
      socket.off('room:settings', onSettings);
      socket.off('room:niveau', onNiveau);
      socket.off('room:langue', onLangue);
      socket.off('room:regles', onRegles);
      socket.off('game:started', onGameStarted);
      socket.off('game:restarted', onGameRestarted);
      socket.off('turn:started', onTurnStarted);
      socket.off('turn:answered', onTurnAnswered);
      socket.off('turn:voted', onTurnVoted);
      socket.off('turn:resolved', onTurnResolved);
      socket.off('turn:passed', onTurnPassed);
      socket.off('turn:questionChoiceOffered', onQuestionChoiceOffered);
      socket.off('turn:niveauChoiceOffered', onNiveauChoiceOffered);
      socket.off('turn:questionReturned', onQuestionReturned);
      socket.off('turn:jugementStarted', onJugementStarted);
      socket.off('turn:surpriseAnswered', onSurpriseAnswered);
      socket.off('turn:surpriseVotingStarted', onSurpriseVotingStarted);
      socket.off('turn:surpriseVoted', onSurpriseVoted);
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

  const updateRoomRegles = useCallback(async (regles) => {
    const res = await emitWithAck('room:regles', regles);
    setRoom((prev) => ({ ...prev, regles: res.regles }));
    return res;
  }, []);

  const startGame = useCallback(() => emitWithAck('game:start', {}), []);

  const restartGame = useCallback(() => emitWithAck('game:rematch', {}), []);

  const sendAnswer = useCallback((text) => emitWithAck('turn:answer', { text }), []);

  const sendVote = useCallback((vote) => emitWithAck('turn:vote', { vote }), []);

  const sendChat = useCallback(
    (text, clientId, replyToId) => emitWithAck('chat:send', { text, clientId, replyToId: replyToId ?? null }),
    []
  );

  // Toujours recalculé depuis la base (table turns) côté serveur : ne renvoie
  // jamais de valeur en cache, on rappelle à chaque ouverture du panneau.
  const fetchRecap = useCallback(() => emitWithAck('recap:fetch', {}), []);

  // ---------- Règle A : le refus qui coûte ----------
  const sendPass = useCallback(() => emitWithAck('turn:pass', {}), []);
  const chooseQuestion = useCallback((questionId) => emitWithAck('turn:questionChoice', { questionId }), []);

  // ---------- Règle B : le double ou rien ----------
  const respondNiveauChoice = useCallback((accept) => emitWithAck('turn:niveauChoice', { accept }), []);

  // ---------- Règle C : la question retournée ----------
  const returnQuestionAction = useCallback(() => emitWithAck('turn:returnQuestion', {}), []);

  // ---------- Règle E : le pari mutuel ----------
  const sendBet = useCallback((text) => emitWithAck('turn:bet', { text }), []);
  const judgeBet = useCallback((verdict) => emitWithAck('turn:judgeBet', { verdict }), []);

  // ---------- Règle D : le tour surprise ----------
  const sendSurpriseAnswer = useCallback((text) => emitWithAck('turn:surpriseAnswer', { text }), []);
  const sendSurpriseVote = useCallback((targetId) => emitWithAck('turn:surpriseVote', { targetId }), []);

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
        updateRoomRegles,
        startGame,
        restartGame,
        sendAnswer,
        sendVote,
        sendChat,
        fetchRecap,
        sendPass,
        chooseQuestion,
        respondNiveauChoice,
        returnQuestionAction,
        sendBet,
        judgeBet,
        sendSurpriseAnswer,
        sendSurpriseVote,
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
