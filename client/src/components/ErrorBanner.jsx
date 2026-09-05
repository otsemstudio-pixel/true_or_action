function ErrorBanner({ children }) {
  if (!children) return null;
  return (
    <div className="banner-error" role="alert">
      {children}
    </div>
  );
}

export default ErrorBanner;
