import { useEffect, useState } from 'react';
import Timer from './Timer.jsx';
import Button from './Button.jsx';
import ErrorBanner from './ErrorBanner.jsx';
import { useI18n } from '../hooks/useI18n.jsx';
import { translateError } from '../i18n/index.js';

const ANSWER_SECONDS = 90;
const VOTE_SECONDS = 30;

function playerName(players, id) {
  return players.find((p) => p.id === id)?.pseudo ?? '…';
}

function TurnPanel({ turn, players, myId, onSubmitAnswer, onVote }) {
  const { t } = useI18n();
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
        <p>{t('partie.preparationDuTour')}</p>
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
      setError(translateError(t, err));
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
      setError(translateError(t, err));
    }
  };

  return (
    <div className="card turn-panel">
      <div className="turn-panel-header">
        <span className={`badge-type badge-type--${turn.type}`}>
          {turn.type === 'verite' ? t('partie.verite') : t('partie.action')}
        </span>
        {turn.phase === 'answering' && <Timer deadline={turn.answerDeadline} totalSeconds={ANSWER_SECONDS} />}
        {turn.phase === 'voting' && <Timer deadline={turn.voteDeadline} totalSeconds={VOTE_SECONDS} />}
      </div>

      <p className="turn-question">{turn.contenu ?? t('partie.questionIndisponible')}</p>

      <ErrorBanner>{error}</ErrorBanner>

      {turn.phase === 'answering' && (
        <>
          {isActive ? (
            <form onSubmit={handleSubmit} className="turn-answer-form">
              <textarea
                className="answer-input"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={t('partie.ecrisTaReponse')}
                rows={3}
                autoFocus
              />
              <Button type="submit" block busy={busy} disabled={!text.trim()}>
                {t('commun.envoyer')}
              </Button>
            </form>
          ) : (
            <p className="menu-item-hint">{t('partie.estEnTrainDeRepondre', { pseudo: activeName })}</p>
          )}
        </>
      )}

      {turn.phase === 'voting' && (
        <>
          <p className="turn-answer-reveal">{t('partie.reponseGuillemet', { reponse: turn.answer })}</p>
          {!voteEnabled ? (
            <p className="menu-item-hint">{t('partie.tourEnResolution')}</p>
          ) : isActive ? (
            <p className="menu-item-hint">{t('partie.enAttenteDesVotes')}</p>
          ) : myVote ? (
            <p className="menu-item-hint">{t('partie.voteEnvoye')}</p>
          ) : (
            <div className="vote-buttons">
              <button
                type="button"
                className="btn btn-secondary vote-btn"
                onClick={() => handleVote('up')}
                aria-label={t('partie.pouceHaut')}
              >
                👍
              </button>
              <button
                type="button"
                className="btn btn-ghost vote-btn"
                onClick={() => handleVote('down')}
                aria-label={t('partie.pouceBas')}
              >
                👎
              </button>
            </div>
          )}
        </>
      )}

      {turn.phase === 'resolved' && <p className="menu-item-hint">{t('partie.tourTermine')}</p>}
    </div>
  );
}

export default TurnPanel;
