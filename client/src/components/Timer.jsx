import { useCountdown } from '../hooks/useCountdown.js';

function Timer({ deadline, totalSeconds }) {
  const remaining = useCountdown(deadline);
  if (!deadline) return null;

  const fraction = totalSeconds ? Math.min(1, remaining / totalSeconds) : 0;
  const low = remaining <= 10;

  return (
    <div className={`timer${low ? ' timer--low' : ''}`} role="timer">
      <div className="timer-bar">
        <div className="timer-bar-fill" style={{ transform: `scaleX(${fraction})` }} />
      </div>
      <span className="timer-value">{remaining}s</span>
    </div>
  );
}

export default Timer;
