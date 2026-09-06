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

// Ne gère plus que la phase de réponse : une fois la réponse envoyée, son
// contenu et le vote qui lui est attaché vivent dans le bloc de réponse posté
// dans le chat (voir AnswerCard / ChatPanel), pas ici en double.
function TurnPanel({ turn, players, myId, onSubmitAnswer }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setText('');
    setBusy(false);
    setError(null);
  }, [turn?.turnNumber]);

  if (!turn) {
    return (
      <div className="turn-panel">
        <p>{t('partie.preparationDuTour')}</p>
      </div>
    );
  }

  const isActive = turn.activePlayerId === myId;
  const activeName = playerName(players, turn.activePlayerId);

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

  return (
    <div className={`turn-panel turn-panel--${turn.type}`}>
      <div className="turn-panel-header">
        <span className={`badge-type badge-type--${turn.type}`}>
          {turn.type === 'verite' ? t('partie.verite') : t('partie.action')}
        </span>
        {turn.phase === 'answering' && <Timer deadline={turn.answerDeadline} totalSeconds={ANSWER_SECONDS} />}
        {turn.phase === 'voting' && <Timer deadline={turn.voteDeadline} totalSeconds={VOTE_SECONDS} />}
      </div>

      <p className="turn-question">{turn.contenu ?? t('partie.questionIndisponible')}</p>

      <ErrorBanner>{error}</ErrorBanner>

      {turn.phase === 'answering' &&
        (isActive ? (
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
        ) : (
          <p className="menu-item-hint">{t('partie.estEnTrainDeRepondre', { pseudo: activeName })}</p>
        ))}

      {turn.phase === 'voting' && <p className="menu-item-hint">{t('partie.reponseDansLeChat')}</p>}
    </div>
  );
}

export default TurnPanel;
