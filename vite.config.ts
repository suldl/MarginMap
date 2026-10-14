import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import pkg from './package.json';
import { copyPdfjsAssets } from './scripts/pdfjs-assets.mjs';

// The dev server needs inline scripts for React refresh, so the CSP is only
// added to production builds.
const csp = (): Plugin => ({
  name: 'marginmap-csp',
  apply: 'build',
  transformIndexHtml(html) {
    const policy = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "worker-src 'self' blob:",
      "connect-src 'self' blob: data:",
    ].join('; ');
    return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${policy}" />`);
  },
});

const pdfjsAssets = (): Plugin => ({
  name: 'marginmap-pdfjs-assets',
  async buildStart() {
    await copyPdfjsAssets();
  },
});

export default defineConfig({
  base: './',
  plugins: [pdfjsAssets(), react(), csp()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
  server: { port: 5173, strictPort: true },
});
