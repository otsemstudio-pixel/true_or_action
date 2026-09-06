import { useEffect, useState } from 'react';
import { useI18n } from '../hooks/useI18n.jsx';

function ResultToast({ result, players }) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!result) return undefined;
    setVisible(true);
    const id = setTimeout(() => setVisible(false), 2600);
    return () => clearTimeout(id);
  }, [result]);

  if (!result || !visible) return null;

  const pseudo = players.find((p) => p.id === result.playerId)?.pseudo ?? '';
  const thumbsUp = Object.values(result.votes).filter((v) => v === 'up').length;

  return (
    <div className="result-toast" role="status">
      {t('partie.gagnePoints', { pseudo, points: result.points, count: result.points })}
      {thumbsUp > 0 ? ` (${thumbsUp} 👍)` : ''}
    </div>
  );
}

export default ResultToast;
