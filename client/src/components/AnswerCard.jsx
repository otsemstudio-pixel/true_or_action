import { useState } from 'react';
import { useI18n } from '../hooks/useI18n.jsx';
import { translateError } from '../i18n/index.js';
import { useLongPress } from '../hooks/useLongPress.js';

// Bloc de réponse encadré, distinct d'un message de chat ordinaire. Le vote
// reste attaché à ce bloc (pas au chat) : tant que le tour est en cours de
// vote, les boutons pouce haut/bas vivent ici, jamais dans le formulaire
// d'envoi de message. C'est aussi un message comme un autre côté serveur
// (turnInfo le marque) : il peut donc être cité, comme n'importe quel message.
function AnswerCard({ message, players, myId, currentTurn, onVote, onReply }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const longPress = useLongPress(() => onReply(message));

  const turn = message.turnInfo;
  const isLiveTurn = currentTurn?.turnNumber === turn.turnNumber && currentTurn.phase === 'voting';
  const activePlayersCount = players.filter((p) => p.status !== 'left').length;
  const voteEnabled = activePlayersCount > 2;
  const alreadyVoted = Boolean(currentTurn?.votes?.[myId]);
  const isRespondent = message.playerId === myId;
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

  return (
    <div id={`msg-${message.id}`} className="answer-card" {...longPress}>
      <div className="answer-card-header">
        <span className="answer-card-author">{message.pseudo}</span>
        {turn.type && (
          <span className={`badge-type badge-type--${turn.type}`}>
            {turn.type === 'verite' ? t('partie.verite') : t('partie.action')}
          </span>
        )}
      </div>
      {turn.contenu && <p className="answer-card-question">{turn.contenu}</p>}
      <p className="answer-card-response">{t('partie.reponseGuillemet', { reponse: message.text })}</p>

      {turn.resolved ? (
        <div className="answer-card-footer">
          <span className="answer-card-points">{t('commun.pointsGagnes', { points: turn.points ?? 0 })}</span>
          {turn.thumbsUp > 0 && <span className="answer-card-thumbs">{turn.thumbsUp} 👍</span>}
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

      <button
        type="button"
        className="message-reply-btn"
        onClick={() => onReply(message)}
        aria-label={t('chat.repondre')}
      >
        ↩
      </button>
    </div>
  );
}

export default AnswerCard;
