import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (!id.includes('node_modules')) return;
          if (id.includes('@babylonjs')) return 'vendor-babylon';
          if (id.includes('react') || id.includes('react-router-dom')) return 'vendor-react';
          if (id.includes('i18next')) return 'vendor-i18n';
          return 'vendor';
        },
      },
    },
  },
});