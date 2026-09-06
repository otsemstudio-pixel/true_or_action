import Spinner from './Spinner.jsx';

const VARIANT_CLASS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  'danger-ghost': 'btn-danger-ghost',
  dark: 'btn-dark',
};

// `arrow` ajoute une flèche directionnelle en fin de bouton (identité visuelle
// des boutons pleine largeur sombres) — seulement là où on la passe
// explicitement, les usages existants ne changent pas.
function Button({
  variant = 'primary',
  block = false,
  busy = false,
  disabled = false,
  arrow = false,
  children,
  ...props
}) {
  const classes = ['btn', VARIANT_CLASS[variant] ?? VARIANT_CLASS.primary];
  if (block) classes.push('btn-block');
  if (arrow) classes.push('btn-arrow');

  return (
    <button className={classes.join(' ')} disabled={disabled || busy} {...props}>
      {busy ? (
        <Spinner />
      ) : arrow ? (
        <>
          <span>{children}</span>
          <span className="btn-arrow-icon" aria-hidden="true">
            →
          </span>
        </>
      ) : (
        children
      )}
    </button>
  );
}

export default Button;
