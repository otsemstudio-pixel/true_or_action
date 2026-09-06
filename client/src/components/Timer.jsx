import { useCountdown } from '../hooks/useCountdown.js';
import { useI18n } from '../hooks/useI18n.jsx';

function Timer({ deadline, totalSeconds }) {
  const { t } = useI18n();
  const remaining = useCountdown(deadline);
  if (!deadline) return null;

  const fraction = totalSeconds ? Math.min(1, remaining / totalSeconds) : 0;
  const low = remaining <= 10;

  return (
    <div className={`timer${low ? ' timer--low' : ''}`} role="timer">
      <div className="timer-bar">
        <div className="timer-bar-fill" style={{ transform: `scaleX(${fraction})` }} />
      </div>
      <span className="timer-value">{t('commun.secondesRestantes', { count: remaining })}</span>
    </div>
  );
}

export default Timer;
