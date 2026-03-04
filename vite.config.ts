import { defineConfig } from 'vite';

const resolvedAppVersion =
  process.env.APP_RELEASE_VERSION ||
  `v${process.env.npm_package_version ?? '0.0.0'}`;

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(resolvedAppVersion)
  },
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
