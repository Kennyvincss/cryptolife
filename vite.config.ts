import { defineConfig } from 'vite';

const SERVER = process.env.CC_SERVER ?? 'http://localhost:8787';

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/api': SERVER,
      '/ws': { target: SERVER.replace('http', 'ws'), ws: true },
    },
  },
  build: { chunkSizeWarningLimit: 2000 },
});
