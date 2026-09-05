import { useEffect, useState } from 'react';

function secondsLeft(deadline) {
  if (!deadline) return 0;
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}

export function useCountdown(deadline) {
  const [remaining, setRemaining] = useState(() => secondsLeft(deadline));

  useEffect(() => {
    setRemaining(secondsLeft(deadline));
    if (!deadline) return undefined;

    const id = setInterval(() => setRemaining(secondsLeft(deadline)), 250);
    return () => clearInterval(id);
  }, [deadline]);

  return remaining;
}
