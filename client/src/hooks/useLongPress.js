import { useRef } from 'react';

const LONG_PRESS_MS = 500;

// Appui long sur mobile pour déclencher la réponse à un message — le
// survol + bouton (desktop) est géré séparément en CSS/JSX, ce hook ne
// couvre que le geste tactile.
export function useLongPress(callback) {
  const timerRef = useRef(null);
  const firedRef = useRef(false);

  const start = () => {
    firedRef.current = false;
    timerRef.current = setTimeout(() => {
      firedRef.current = true;
      callback();
    }, LONG_PRESS_MS);
  };

  const clear = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  };

  return {
    onTouchStart: start,
    onTouchEnd: clear,
    onTouchMove: clear,
    onTouchCancel: clear,
  };
}
