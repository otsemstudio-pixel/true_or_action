import { useEffect, useState } from 'react';
import Timer from './Timer.jsx';
import Button from './Button.jsx';
import ErrorBanner from './ErrorBanner.jsx';
import { useI18n } from '../hooks/useI18n.jsx';
import { translateError } from '../i18n/index.js';

const VOTE_SECONDS = 30;

function playerName(players, id) {
  return players.find((p) => p.id === id)?.pseudo ?? '…';
}

// Règle D : tous les joueurs répondent à la même question, en simultané, puis
// votent pour la meilleure réponse (jamais la leur). Panneau dédié plutôt
// qu'une variante de TurnPanel — la forme des données (plusieurs répondants,
// vote par cible plutôt que pouce haut/bas) est trop différente pour partager
// le même composant sans le complexifier inutilement.
function SurpriseTurnPanel({ turn, players, myId, answerSec, onSubmitAnswer, onVote }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setText('');
    setBusy(false);
    setError(null);
  }, [turn?.turnNumber, turn?.phase]);

  const hasAnswered = turn.answeredPlayerIds?.includes(myId);
  const hasVoted = Boolean(turn.votes?.[myId]);

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

  const handleVote = async (targetId) => {
    setError(null);
    setBusy(true);
    try {
      await onVote(targetId);
    } catch (err) {
      setError(translateError(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="turn-panel turn-panel--surprise">
      <div className="turn-panel-header">
        <span className="regle-badge">{t('partie.tourSurpriseTitre')}</span>
        {turn.phase === 'answering' && <Timer deadline={turn.answerDeadline} totalSeconds={answerSec} />}
        {turn.phase === 'voting' && <Timer deadline={turn.voteDeadline} totalSeconds={VOTE_SECONDS} />}
      </div>

      <p className="turn-question">{turn.contenu}</p>
      <ErrorBanner>{error}</ErrorBanner>

      {turn.phase === 'answering' &&
        (hasAnswered ? (
          <p className="menu-item-hint">
            {t('partie.tourSurpriseProgression', {
              count: turn.answeredPlayerIds.length,
              total: turn.activePlayerIds.length,
            })}
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="turn-answer-form">
            <textarea
              className="answer-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={t('partie.ecrisTaReponse')}
              rows={3}
              autoFocus
            />
            <Button type="submit" variant="dark" block arrow busy={busy} disabled={!text.trim()}>
              {t('commun.envoyer')}
            </Button>
          </form>
        ))}

      {turn.phase === 'voting' &&
        (hasVoted ? (
          <p className="menu-item-hint">{t('partie.tourSurpriseDejaVote')}</p>
        ) : (
          <>
            <p className="turn-question">{t('partie.tourSurpriseVoterTitre')}</p>
            <div className="question-choice-list">
              {(turn.answers ?? [])
                .filter((a) => a.playerId !== myId)
                .map((a) => (
                  <button
                    key={a.playerId}
                    type="button"
                    className="question-choice-item"
                    disabled={busy}
                    onClick={() => handleVote(a.playerId)}
                  >
                    <span className="answer-card-author">{playerName(players, a.playerId)}</span>
                    <span>{a.text}</span>
                  </button>
                ))}
            </div>
          </>
        ))}
    </div>
  );
}

export default SurpriseTurnPanel;
