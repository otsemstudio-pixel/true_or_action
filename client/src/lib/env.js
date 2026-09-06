export const API_URL = import.meta.env.VITE_API_URL;

if (!API_URL) {
  throw new Error(
    "VITE_API_URL est manquant. En développement, créez client/.env à partir de client/.env.example. " +
      "En production, définissez VITE_API_URL avant de lancer le build."
  );
}
