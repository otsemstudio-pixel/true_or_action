function TextField({ id, label, error, ...props }) {
  return (
    <div className={`field${error ? ' field-error' : ''}`}>
      <label htmlFor={id}>{label}</label>
      <input id={id} {...props} />
      {error && (
        <span className="field-error-text" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}

export default TextField;
