function Spinner({ label = 'Chargement' }) {
  return <span className="spinner" role="status" aria-label={label} />;
}

export default Spinner;
