import { useEffect, useState } from 'react';
import { useI18n } from '../hooks/useI18n.jsx';

// Pastille "+N" qui apparaît puis s'estompe — pas une phrase complète : le
// détail (qui, combien de votes) reste en légende discrète en dessous.
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

  const pseudo = players.find((p) => p.id === result.playerId)?.pseudo ?? '';
  const thumbsUp = Object.values(result.votes).filter((v) => v === 'up').length;

  return (
    <div className={`result-toast${phase === 'fading' ? ' result-toast--fading' : ''}`} role="status">
      <span className="result-toast-points">{t('commun.pointsGagnes', { points: result.points })}</span>
      <span className="result-toast-caption">
        {pseudo}
        {thumbsUp > 0 ? ` · ${thumbsUp} 👍` : ''}
      </span>
    </div>
  );
}

export default ResultToast;
