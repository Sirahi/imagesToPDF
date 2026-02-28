import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('pdf-lib')) {
              return 'pdf-lib';
            }
            if (id.includes('konva') || id.includes('react-konva')) {
              return 'konva';
            }
            return 'vendor';
          }
          return undefined;
        }
      }
    }
  },
  server: {
    host: '0.0.0.0',
    port: 5173
  }
});
