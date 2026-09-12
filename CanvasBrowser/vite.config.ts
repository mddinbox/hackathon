import { defineConfig } from 'vite';

// CanvasBrowser is fully static: no proxy and no application fetch. The one
// external thing a page loads is the Bing Maps base the Journey World frames,
// which the browser requests for itself and the demo CSP scopes to bing.com.
export default defineConfig(({ mode }) => ({
  root: '.',
  base: './',
  build: {
    outDir: mode === 'test' ? 'dist-test' : mode === 'demo' ? 'dist-demo' : 'dist',
    sourcemap: true
  },
  server: {
    port: 5183,
    strictPort: true
  },
  preview: {
    port: 4174,
    strictPort: true
  }
}));
