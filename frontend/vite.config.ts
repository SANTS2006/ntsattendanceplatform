/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const api = env.VITE_DEV_API_PROXY ?? 'http://localhost:4000';
  return {
    plugins: [
      react(),
      tailwindcss(),
      // Installable Progressive Web App: manifest + Workbox service worker (app shell only).
      VitePWA({
        registerType: 'prompt', // ask before activating a new version (never reload mid-form)
        injectRegister: false, // registered from React (src/pwa/PwaUi.tsx)
        includeAssets: ['favicon.png', 'theme-init.js', 'logo.png', 'logo-192.png', 'icons/apple-touch-icon.png'],
        manifest: {
          id: '/',
          name: 'NTSAttend — Secure QR Attendance',
          short_name: 'NTSAttend',
          description: 'Secure QR attendance with GPS geofencing, automatic student ID checks and selfies for universities, schools, colleges and events.',
          lang: 'en',
          dir: 'ltr',
          start_url: '/app',
          scope: '/',
          display: 'standalone',
          display_override: ['standalone', 'minimal-ui'],
          orientation: 'any',
          background_color: '#0b1f4d',
          theme_color: '#0b1f4d',
          categories: ['education', 'productivity', 'business'],
          icons: [
            { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
            { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
          shortcuts: [
            { name: 'Start attendance', short_name: 'New session', url: '/app/attendance/new', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
            { name: 'Attendance records', short_name: 'Records', url: '/app/records', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
            { name: 'Notifications', url: '/app/notifications', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
          ],
        },
        workbox: {
          // Precache the app shell (code, styles, fonts, icons). API data is never cached.
          globPatterns: ['**/*.{js,css,html,woff2,png,webp,svg,ico}'],
          globIgnores: ['**/logo.webp'],
          maximumFileSizeToCacheInBytes: 3 * 1024 * 1024,
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/health\//, /^\/socket\.io\//],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          runtimeCaching: [
            {
              // Never serve API responses from a cache (auth, tenant data, attendance).
              urlPattern: ({ url }) => url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/'),
              handler: 'NetworkOnly',
            },
          ],
        },
        devOptions: { enabled: false },
      }),
    ],
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
