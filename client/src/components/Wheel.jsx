import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../hooks/useI18n.jsx';

const SEGMENTS = 8;
const SEGMENT_ANGLE = 360 / SEGMENTS;

function segmentType(index) {
  return index % 2 === 0 ? 'verite' : 'action';
}

// Le serveur a déjà tiré le résultat (voir turn:started) ; on choisit seulement,
// parmi les secteurs du bon type, lequel afficher — pure mise en scène.
function pickTargetIndex(type, turnNumber) {
  const candidates = [];
  for (let i = 0; i < SEGMENTS; i++) {
    if (segmentType(i) === type) candidates.push(i);
  }
  return candidates[turnNumber % candidates.length];
}

function Wheel({ type, turnNumber }) {
  const { t } = useI18n();
  const [rotation, setRotation] = useState(0);
  const rotationRef = useRef(0);
  const spunForTurn = useRef(null);

  useEffect(() => {
    if (!type || turnNumber == null || spunForTurn.current === turnNumber) return;
    spunForTurn.current = turnNumber;

    const targetIndex = pickTargetIndex(type, turnNumber);
    const targetCenter = targetIndex * SEGMENT_ANGLE + SEGMENT_ANGLE / 2;
    const desiredMod = (360 - targetCenter) % 360;
    const currentMod = ((rotationRef.current % 360) + 360) % 360;

    let delta = desiredMod - currentMod;
    if (delta <= 0) delta += 360;

    const next = rotationRef.current + delta + 4 * 360;
    rotationRef.current = next;
    setRotation(next);
  }, [type, turnNumber]);

  return (
    <div className="wheel-wrap">
      <div className="wheel-pointer" aria-hidden="true" />
      <div className="wheel" style={{ transform: `rotate(${rotation}deg)` }} aria-hidden="true" />
      <span className="sr-only">
        {type ? t('partie.resultat', { type: type === 'verite' ? t('partie.verite') : t('partie.action') }) : t('partie.resultatAttente')}
      </span>
    </div>
  );
}

export default Wheel;
