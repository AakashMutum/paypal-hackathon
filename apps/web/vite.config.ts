import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { '@checkout-guardian/contracts': path.resolve(__dirname, '../../packages/contracts/src/index.ts') } },
  server: { port: 5173, proxy: { '/api': { target: process.env.VITE_API_TARGET || 'http://localhost:4000', changeOrigin: true } } },
});
