import { useState } from 'react';
import { useI18n } from '../hooks/useI18n.jsx';
import { translateError } from '../i18n/index.js';

// Bloc de réponse encadré, distinct d'un message de chat ordinaire. Le vote
// reste attaché à ce bloc (pas au chat) : tant que le tour est en cours de
// vote, les boutons pouce haut/bas vivent ici, jamais dans le formulaire
// d'envoi de message.
function AnswerCard({ card, players, myId, currentTurn, onVote }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const isLiveTurn = currentTurn?.turnNumber === card.turnNumber && currentTurn.phase === 'voting';
  const activePlayersCount = players.filter((p) => p.status !== 'left').length;
  const voteEnabled = activePlayersCount > 2;
  const alreadyVoted = Boolean(currentTurn?.votes?.[myId]);
  const isRespondent = card.playerId === myId;
  const canVote = isLiveTurn && voteEnabled && !isRespondent && !alreadyVoted;

  const handleVote = async (vote) => {
    setError(null);
    setBusy(true);
    try {
      await onVote(vote);
    } catch (err) {
      setError(translateError(t, err));
    } finally {
      setBusy(false);
    }
  };

  const thumbsUp = card.votes ? Object.values(card.votes).filter((v) => v === 'up').length : 0;

  return (
    <div className="answer-card">
      <div className="answer-card-header">
        <span className="answer-card-author">{card.pseudo}</span>
        {card.type && (
          <span className={`badge-type badge-type--${card.type}`}>
            {card.type === 'verite' ? t('partie.verite') : t('partie.action')}
          </span>
        )}
      </div>
      {card.contenu && <p className="answer-card-question">{card.contenu}</p>}
      <p className="answer-card-response">
        {card.answer != null ? t('partie.reponseGuillemet', { reponse: card.answer }) : t('partie.tempsEcoule')}
      </p>

      {card.phase === 'resolved' ? (
        <div className="answer-card-footer">
          <span className="answer-card-points">{t('commun.pointsGagnes', { points: card.points ?? 0 })}</span>
          {thumbsUp > 0 && <span className="answer-card-thumbs">{thumbsUp} 👍</span>}
        </div>
      ) : canVote ? (
        <>
          {error && <p className="field-error-text">{error}</p>}
          <div className="vote-buttons">
            <button
              type="button"
              className="btn btn-secondary vote-btn"
              disabled={busy}
              onClick={() => handleVote('up')}
              aria-label={t('partie.pouceHaut')}
            >
              👍
            </button>
            <button
              type="button"
              className="btn btn-ghost vote-btn"
              disabled={busy}
              onClick={() => handleVote('down')}
              aria-label={t('partie.pouceBas')}
            >
              👎
            </button>
          </div>
        </>
      ) : isLiveTurn && isRespondent ? (
        <p className="menu-item-hint">{t('partie.enAttenteDesVotes')}</p>
      ) : isLiveTurn && alreadyVoted ? (
        <p className="menu-item-hint">{t('partie.voteEnvoye')}</p>
      ) : null}
    </div>
  );
}

export default AnswerCard;
