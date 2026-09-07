// `hint` : indication affichée avant toute tentative de soumission (ex. la
// longueur minimale d'un mot de passe) — masquée dès qu'une erreur apparaît
// pour ce champ, l'erreur devenant alors le message le plus utile.
function TextField({ id, label, error, hint, ...props }) {
  return (
    <div className={`field${error ? ' field-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <input id={id} {...props} />
      {hint && !error && <span className="field-hint-text">{hint}</span>}
      {error && (
        <span className="field-error-text" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export default TextField;
