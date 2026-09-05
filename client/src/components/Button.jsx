import Spinner from './Spinner.jsx';

const VARIANT_CLASS = {
  primary: 'btn-primary',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  'danger-ghost': 'btn-danger-ghost',
};

function Button({ variant = 'primary', block = false, busy = false, disabled = false, children, ...props }) {
  const classes = ['btn', VARIANT_CLASS[variant] ?? VARIANT_CLASS.primary];
  if (block) classes.push('btn-block');

  return (
    <button className={classes.join(' ')} disabled={disabled || busy} {...props}>
      {busy ? <Spinner /> : children}
    </button>
  );
}

export default Button;
