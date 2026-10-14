// Checks that every LaTeX autocomplete suggestion renders in KaTeX (run: node scripts/check-latex.mjs).
import { build } from 'esbuild';
import katex from 'katex';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import fs from 'node:fs';
import os from 'node:os';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'mm-latex-')), 'commands.mjs');
await build({ entryPoints: [path.join(root, 'src/lib/latexCommands.ts')], outfile: out, bundle: true, format: 'esm', platform: 'node', logLevel: 'error' });
const { TEX_COMMANDS } = await import(pathToFileURL(out).href);

let bad = 0;
const seen = new Set();
for (const c of TEX_COMMANDS) {
  if (seen.has(c.name)) {
    console.log(`duplicate: ${c.name}`);
    bad++;
  }
  seen.add(c.name);
  // The inserted text with placeholders filled must render too.
  const filled = c.insert.replace(/\$\d/g, 'x');
  for (const tex of [c.preview, filled]) {
    try {
      katex.renderToString(tex, { throwOnError: true, strict: 'ignore' });
    } catch (err) {
      console.log(`${c.name}: ${tex} -> ${err.message}`);
      bad++;
    }
  }
}
console.log(bad ? `${bad} problem(s) in ${TEX_COMMANDS.length} commands` : `All ${TEX_COMMANDS.length} commands render.`);
process.exit(bad ? 1 : 0);
