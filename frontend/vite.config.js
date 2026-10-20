import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const demo = mode === 'demo';
  const target = demo ? 'http://127.0.0.1:4001' : 'http://127.0.0.1:4000';

  return {
    plugins: [react()],
    // Force these values even if a local .env or shell points at 4000.
    // All existing API and Socket.IO clients consume these two settings.
    ...(demo ? {
      define: {
        'import.meta.env.VITE_API_URL': JSON.stringify('/api'),
        'import.meta.env.VITE_SOCKET_URL': JSON.stringify('http://localhost:5173'),
      },
    } : {}),
    server: {
      // IPv4 loopback also supports ADB reverse without a LAN listener.
      host: demo ? '127.0.0.1' : '0.0.0.0',
      port: 5173,
      ...(demo ? { strictPort: true } : {}),
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
        },
        ...(demo ? {
          '/socket.io': {
            target,
            changeOrigin: true,
            ws: true,
          },
        } : {}),
      },
    },
  };
});
