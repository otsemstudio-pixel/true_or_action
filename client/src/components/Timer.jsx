import { useCountdown } from '../hooks/useCountdown.js';
import { useI18n } from '../hooks/useI18n.jsx';

function Timer({ deadline, totalSeconds }) {
  const { t } = useI18n();
  const remaining = useCountdown(deadline);
  if (!deadline) return null;

  const fraction = totalSeconds ? Math.min(1, Math.max(0, remaining / totalSeconds)) : 0;
  const low = remaining <= 10;

  return (
    <div
      className={`timer${low ? ' timer--low' : ''}`}
      role="timer"
      style={{ '--timer-progress': `${fraction * 100}%` }}
    >
      <span className="timer-value" aria-hidden="true">
        {remaining}
      </span>
      <span className="sr-only">{t('commun.secondesRestantes', { count: remaining })}</span>
    </div>
  );
}

export default Timer;
