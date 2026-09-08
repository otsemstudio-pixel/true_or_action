// Icônes des jokers de la catégorie Régularité : un seul trait
// (currentColor), même épaisseur partout — la teinte vient du token de
// catégorie posé par JokerCard, jamais fixée ici (voir jokers.js). Chaque
// icône se distingue par sa forme, jamais par sa couleur.
const STROKE = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export function LeFideleIcon(props) {
  return (
    <svg viewBox="0 0 32 32" {...STROKE} {...props}>
      <path d="M16 27C9 22 4 17.5 4 12.5 4 9 6.7 6.5 10 6.5c2.2 0 4.2 1.2 6 3.3 1.8-2.1 3.8-3.3 6-3.3 3.3 0 6 2.5 6 6 0 5-5 9.5-12 14.5Z" />
    </svg>
  );
}

export function LeMetronomeIcon(props) {
  return (
    <svg viewBox="0 0 32 32" {...STROKE} {...props}>
      <path d="M10 27h12L18 6h-4L10 27Z" />
      <path d="M16 9l4 15" />
      <circle cx="19.2" cy="17" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function LIncrevableIcon(props) {
  return (
    <svg viewBox="0 0 32 32" {...STROKE} {...props}>
      <path d="M16 4l10 4v8c0 7-4.5 11.5-10 13-5.5-1.5-10-6-10-13V8l10-4Z" />
    </svg>
  );
}

export function LeVeteranIcon(props) {
  return (
    <svg viewBox="0 0 32 32" {...STROKE} {...props}>
      <path d="M8 14l8-6 8 6" />
      <path d="M8 22l8-6 8 6" />
    </svg>
  );
}

export function LeRituelIcon(props) {
  return (
    <svg viewBox="0 0 32 32" {...STROKE} {...props}>
      <path d="M13 14h6v13a3 3 0 0 1-6 0V14Z" />
      <path d="M16 14v-4" />
      <path d="M16 6c1.5 1.5 1.5 3 0 4-1.5-1-1.5-2.5 0-4Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
