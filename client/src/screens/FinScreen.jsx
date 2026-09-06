import { useState } from 'react';
import { useAuth } from '../hooks/useAuth.jsx';
import { useRoom } from '../hooks/useRoom.jsx';
import { useI18n } from '../hooks/useI18n.jsx';
import { translateError } from '../i18n/index.js';
import Button from '../components/Button.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import RecapPanel from '../components/RecapPanel.jsx';

const MEDALS = ['🥇', '🥈', '🥉'];

function FinScreen() {
  const { user } = useAuth();
  const { room, restartGame, leaveRoom } = useRoom();
  const { t } = useI18n();
  const myId = String(user.id);
  const isHost = room.hostId === myId;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [recapOpen, setRecapOpen] = useState(false);

  const ranking = room.ranking ?? [];
  const winner = ranking[0];
  const winnerPlayer = winner ? room.players.find((p) => p.id === winner.playerId) : null;

  const handleRestart = async () => {
    setError(null);
    setBusy(true);
    try {
      await restartGame();
    } catch (err) {
      setError(translateError(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <header>
        <h1 className="fin-title">{t('fin.partieTerminee')}</h1>
      </header>

      <ErrorBanner>{error}</ErrorBanner>

      {winner ? (
        <>
          <div className="fin-winner">
            <span className="fin-winner-medal" aria-hidden="true">
              🥇
            </span>
            <span className="fin-winner-name">{winnerPlayer?.pseudo ?? '—'}</span>
            <span className="fin-winner-score">{winner.score}</span>
          </div>

          {ranking.length > 1 && (
            <ol className="ranking-list">
              {ranking.slice(1).map((r, index) => {
                const player = room.players.find((p) => p.id === r.playerId);
                return (
                  <li key={r.playerId} className="ranking-row">
                    <span className="ranking-position">{MEDALS[index + 1] ?? index + 2}</span>
                    <span className="ranking-name">{player?.pseudo ?? '—'}</span>
                    <span className="ranking-score">{r.score}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </>
      ) : (
        <p className="menu-item-hint">{t('fin.classementIndisponible')}</p>
      )}

      <Button variant="ghost" block onClick={() => setRecapOpen(true)}>
        {t('partie.recapitulatif')}
      </Button>

      {isHost ? (
        <Button variant="dark" block arrow busy={busy} onClick={handleRestart}>
          {t('fin.rejouer')}
        </Button>
      ) : (
        <p className="menu-item-hint">{t('fin.enAttenteHoteRelance')}</p>
      )}

      <Button variant="danger-ghost" onClick={leaveRoom}>
        {t('commun.quitter')}
      </Button>

      <RecapPanel open={recapOpen} onClose={() => setRecapOpen(false)} />
    </div>
  );
}

export default FinScreen;
