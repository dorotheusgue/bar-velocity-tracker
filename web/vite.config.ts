import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // Keep TF.js out of the main bundle. It only loads when the user opts
        // into the COCO-SSD "Auto" detector via the debug sheet.
        manualChunks(id) {
          if (id.includes('@tensorflow') || id.includes('coco-ssd')) {
            return 'tfjs';
          }
        },
      },
    },
  },
});
