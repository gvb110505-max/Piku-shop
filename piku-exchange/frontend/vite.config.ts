import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// 개발 서버: /api, /ws 를 백엔드(8080)로 프록시
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/ws': { target: 'ws://localhost:8080', ws: true },
    },
  },
});
