import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
const apiTarget = process.env.VITE_API_TARGET || 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@checkout-guardian/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts') } },
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/health': { target: apiTarget, changeOrigin: true },
    },
  },
});
