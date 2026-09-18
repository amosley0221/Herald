import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite, configured for Tauri.
 *
 * The fixed port matters: `tauri.conf.json` points its dev window at it, and a
 * Vite that silently moved to the next free port would leave the window blank.
 */
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
    watch: {
      // The Rust side has its own watcher; letting Vite walk target/ makes
      // startup slow and triggers pointless reloads.
      ignored: ['**/src-tauri/**'],
    },
  },
  build: {
    // Tauri bundles the built assets; no minification secrets to keep, but the
    // sourcemap makes a production stack trace readable.
    sourcemap: true,
    target: 'es2022',
  },
});
