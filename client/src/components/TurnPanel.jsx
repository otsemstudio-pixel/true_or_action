import { useEffect, useState } from 'react';
import Timer from './Timer.jsx';
import Button from './Button.jsx';
import ErrorBanner from './ErrorBanner.jsx';

const ANSWER_SECONDS = 90;
const VOTE_SECONDS = 30;

function playerName(players, id) {
  return players.find((p) => p.id === id)?.pseudo ?? '…';
}

function TurnPanel({ turn, players, myId, onSubmitAnswer, onVote }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [myVote, setMyVote] = useState(null);

  useEffect(() => {
    setText('');
    setBusy(false);
    setError(null);
    setMyVote(null);
  }, [turn?.turnNumber]);

  if (!turn) {
    return (
      <div className="card turn-panel">
        <p>Préparation du tour…</p>
      </div>
    );
  }

  const isActive = turn.activePlayerId === myId;
  const activeName = playerName(players, turn.activePlayerId);
  // Le joueur actif ne vote pas pour lui-même : à 2 joueurs il ne resterait
  // qu'un seul votant, ce qui vide le vote de son sens. Le serveur saute déjà
  // la phase de vote dans ce cas (elle ne devrait donc jamais être observée
  // ici), mais on masque aussi l'UI de vote par sécurité si jamais elle l'était.
  const activePlayersCount = players.filter((p) => p.status !== 'left').length;
  const voteEnabled = activePlayersCount > 2;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await onSubmitAnswer(text.trim());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const handleVote = async (vote) => {
    setError(null);
    setMyVote(vote);
    try {
      await onVote(vote);
    } catch (err) {
      setMyVote(null);
      setError(err.message);
    }
  };

  return (
    <div className="card turn-panel">
      <div className="turn-panel-header">
        <span className={`badge-type badge-type--${turn.type}`}>
          {turn.type === 'verite' ? 'Vérité' : 'Action'}
        </span>
        {turn.phase === 'answering' && <Timer deadline={turn.answerDeadline} totalSeconds={ANSWER_SECONDS} />}
        {turn.phase === 'voting' && <Timer deadline={turn.voteDeadline} totalSeconds={VOTE_SECONDS} />}
      </div>

      <p className="turn-question">{turn.contenu ?? 'Question indisponible pour ce tour.'}</p>

      <ErrorBanner>{error}</ErrorBanner>

      {turn.phase === 'answering' && (
        <>
          {isActive ? (
            <form onSubmit={handleSubmit} className="turn-answer-form">
              <textarea
                className="answer-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="Écris ta réponse…"
                rows={3}
                autoFocus
              />
              <Button type="submit" block busy={busy} disabled={!text.trim()}>
                Envoyer
              </Button>
            </form>
          ) : (
            <p className="menu-item-hint">{activeName} est en train de répondre…</p>
          )}
        </>
      )}

      {turn.phase === 'voting' && (
        <>
          <p className="turn-answer-reveal">« {turn.answer} »</p>
          {!voteEnabled ? (
            <p className="menu-item-hint">Tour en cours de résolution…</p>
          ) : isActive ? (
            <p className="menu-item-hint">En attente des votes des autres joueurs…</p>
          ) : myVote ? (
            <p className="menu-item-hint">Vote envoyé, en attente des autres…</p>
          ) : (
            <div className="vote-buttons">
              <button
                type="button"
                className="btn btn-secondary vote-btn"
                onClick={() => handleVote('up')}
                aria-label="Pouce vers le haut"
              >
                👍
              </button>
              <button
                type="button"
                className="btn btn-ghost vote-btn"
                onClick={() => handleVote('down')}
                aria-label="Pouce vers le bas"
              >
                👎
              </button>
            </div>
          )}
        </>
      )}

      {turn.phase === 'resolved' && <p className="menu-item-hint">Tour terminé, préparation du suivant…</p>}
    </div>
  );
}

export default TurnPanel;
