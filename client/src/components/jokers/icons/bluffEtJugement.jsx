// Icônes des jokers de la catégorie Bluff et jugement : même style que
// regularite.jsx (trait unique, currentColor, teinte posée par JokerCard) —
// voir ce fichier pour la convention STROKE, reprise à l'identique ici.
const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function LeParieurIcon(props) {
  return (
    <svg viewBox="0 0 32 32" {...STROKE} {...props}>
      <rect x="6" y="6" width="20" height="20" rx="4" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="16" cy="16" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="20" cy="20" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function LeSemeurDeDouteIcon(props) {
  return (
    <svg viewBox="0 0 32 32" {...STROKE} {...props}>
      <path d="M11 12a5 5 0 1 1 7.5 4.3C17 17.2 16 18.3 16 20" />
      <circle cx="16" cy="25" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function LeMasqueIcon(props) {
  return (
    <svg viewBox="0 0 32 32" {...STROKE} {...props}>
      <path d="M6 12c3-3 6-4 10-4s7 1 10 4c0 8-4 13-10 13S6 20 6 12Z" />
      <path d="M11 14c1-1 2-1 3 0" />
      <path d="M18 14c1-1 2-1 3 0" />
    </svg>
  );
}

export function LeLimierIcon(props) {
  return (
    <svg viewBox="0 0 32 32" {...STROKE} {...props}>
      <circle cx="14" cy="14" r="7" />
      <path d="M19.5 19.5 26 26" />
    </svg>
  );
}

export function LeSceptiquePerpetuelIcon(props) {
  return (
    <svg viewBox="0 0 32 32" {...STROKE} {...props}>
      <path d="M8 12c1.5-2 4-2 5.5-0.5" />
      <path d="M18.5 11.5H24" />
      <circle cx="11.5" cy="17" r="1" fill="currentColor" stroke="none" />
      <circle cx="20.5" cy="17" r="1" fill="currentColor" stroke="none" />
      <path d="M11 23c2.5-1.5 7.5-1.5 10 0" />
    </svg>
  );
}
