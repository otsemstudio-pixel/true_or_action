import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd());

  if (command === 'build' && !env.VITE_API_URL) {
    throw new Error(
      "VITE_API_URL est manquant. Définissez cette variable d'environnement avant de lancer le build de production (voir client/.env.example)."
    );
  }

  return {
    plugins: [react()],
    server: {
      port: 5173,
    },
  };
});
