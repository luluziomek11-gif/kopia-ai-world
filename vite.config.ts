import { defineConfig } from 'vite';
export default defineConfig({
  root: 'client',
  server: { port: 5173, strictPort: true, proxy: { '/ws': { target: 'ws://127.0.0.1:3001', ws: true }, '/api': 'http://127.0.0.1:3001' } },
  build: { outDir: '../dist', emptyOutDir: true, rollupOptions: { output: { manualChunks: { phaser: ['phaser'] } } }, chunkSizeWarningLimit: 1500 }
});
