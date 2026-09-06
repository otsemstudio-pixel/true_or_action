import { useEffect, useState } from 'react';
import Button from './Button.jsx';
import ErrorBanner from './ErrorBanner.jsx';
import { useI18n } from '../hooks/useI18n.jsx';
import { translateError } from '../i18n/index.js';

function playerName(players, id) {
  return players.find((p) => p.id === id)?.pseudo ?? '…';
}

// Règle E : avant que le joueur actif réponde, l'autre écrit ce qu'il pense
// qu'il va dire. Le pari reste caché du joueur actif côté serveur (jamais
// diffusé avant la phase de jugement) ; ici, "envoyé" est un simple état
// local qui ne dépend pas de room.currentTurn pour la même raison.
function PariMutuelPanel({ turn, players, myId, onSendBet }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    setText('');
    setBusy(false);
    setError(null);
    setSent(false);
  }, [turn?.turnNumber]);

  if (!turn || turn.mode !== 'normal' || turn.phase !== 'answering' || turn.activePlayerId === myId) {
    return null;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setError(null);
    setBusy(true);
    try {
      await onSendBet(text.trim());
      setSent(true);
    } catch (err) {
      setError(translateError(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="turn-panel">
      <ErrorBanner>{error}</ErrorBanner>
      {sent ? (
        <p className="menu-item-hint">{t('partie.pariEnvoye')}</p>
      ) : (
        <form onSubmit={handleSubmit} className="turn-answer-form">
          <p className="turn-question">{t('partie.pariEcrisTonPari', { pseudo: playerName(players, turn.activePlayerId) })}</p>
          <textarea
            className="answer-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={2}
          />
          <Button type="submit" variant="secondary" block busy={busy} disabled={!text.trim()}>
            {t('partie.pariEnvoyer')}
          </Button>
        </form>
      )}
    </div>
  );
}

export default PariMutuelPanel;
