function initials(pseudo) {
  return pseudo.slice(0, 2).toUpperCase();
}

function ScoreBoard({ players, activePlayerId }) {
  return (
    <ul className="scoreboard">
      {players.map((p) => (
        <li
          key={p.id}
          className={`score-chip${p.id === activePlayerId ? ' score-chip--active' : ''}${
            p.status !== 'active' ? ' score-chip--offline' : ''
          }`}
        >
          <span className="score-chip-avatar">{initials(p.pseudo)}</span>
          <span className="score-chip-name">{p.pseudo}</span>
          <span className="score-chip-value">{p.score}</span>
        </li>
      ))}
    </ul>
  );
}

export default ScoreBoard;
