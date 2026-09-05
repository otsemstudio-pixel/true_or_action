import { useEffect, useState } from 'react';

function ResultToast({ result, players }) {
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
      {pseudo} gagne {result.points} point{result.points > 1 ? 's' : ''}
      {thumbsUp > 0 ? ` (${thumbsUp} 👍)` : ''}
    </div>
  );
}

export default ResultToast;
