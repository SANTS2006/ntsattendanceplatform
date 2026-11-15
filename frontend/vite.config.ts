/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const api = env.VITE_DEV_API_PROXY ?? 'http://localhost:4000';
  return {
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') }, dedupe: ['react', 'react-dom', 'react-router-dom', '@tanstack/react-query'] },
    server: {
      port: 5173,
      // Same-origin API in development: the HttpOnly refresh cookie stays first-party.
      proxy: {
        '/api': { target: api, changeOrigin: false },
        '/socket.io': { target: api, ws: true },
      },
    },
    build: { sourcemap: true, chunkSizeWarningLimit: 900 },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      include: ['src/**/*.test.{ts,tsx}'],
      css: false,
    },
  };
});
