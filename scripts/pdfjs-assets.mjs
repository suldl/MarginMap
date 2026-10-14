// Copies the pdf.js runtime assets (CJK character maps, standard fonts, wasm
// image decoders) into public/ so both the dev server and builds can serve them.
import { cp, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'node_modules', 'pdfjs-dist');
const dest = path.join(root, 'public', 'pdfjs');

export async function copyPdfjsAssets() {
  for (const dir of ['cmaps', 'standard_fonts', 'wasm']) {
    const to = path.join(dest, dir);
    try {
      await stat(to);
      continue;
    } catch {
      // not copied yet
    }
    await cp(path.join(src, dir), to, { recursive: true });
  }
}
