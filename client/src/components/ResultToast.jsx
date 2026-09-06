import { useEffect, useState } from 'react';
import { useI18n } from '../hooks/useI18n.jsx';

function playerName(players, id) {
  return players.find((p) => p.id === id)?.pseudo ?? '';
}

// Pastille "+N" qui apparaît puis s'estompe — pas une phrase complète : le
// détail (qui, combien de votes) reste en légende discrète en dessous. Gère
// aussi les issues des règles optionnelles (refus à points négatifs, tour
// surprise à plusieurs gagnants) avec le même gabarit visuel.
function ResultToast({ result, players }) {
  const { t } = useI18n();
  const [phase, setPhase] = useState('hidden'); // hidden | visible | fading

  useEffect(() => {
    if (!result) return undefined;
    setPhase('visible');
    const fadeId = setTimeout(() => setPhase('fading'), 1600);
    const hideId = setTimeout(() => setPhase('hidden'), 2400);
    return () => {
      clearTimeout(fadeId);
      clearTimeout(hideId);
    };
  }, [result]);

  if (!result || phase === 'hidden') return null;

  let pointsLabel;
  let caption;

  if (result.mode === 'surprise') {
    const winner = result.results.find((r) => result.winnerIds.includes(r.playerId));
    pointsLabel = t('commun.pointsGagnes', { points: winner?.points ?? 0 });
    caption = result.winnerIds.map((id) => playerName(players, id)).join(', ');
  } else {
    const pseudo = playerName(players, result.playerId);
    pointsLabel = result.points >= 0 ? t('commun.pointsGagnes', { points: result.points }) : String(result.points);
    const thumbsUp = result.votes ? Object.values(result.votes).filter((v) => v === 'up').length : 0;
    caption = `${pseudo}${thumbsUp > 0 ? ` · ${thumbsUp} 👍` : ''}`;
  }

  return (
    <div className={`result-toast${phase === 'fading' ? ' result-toast--fading' : ''}`} role="status">
      <span className="result-toast-points">{pointsLabel}</span>
      <span className="result-toast-caption">{caption}</span>
    </div>
  );
}

export default ResultToast;
