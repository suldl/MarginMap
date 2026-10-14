// Development runner: Vite dev server for the UI + esbuild watch for the
// Electron main/preload, restarting Electron when those change.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import electronPath from 'electron';
import { watchElectron } from './build-electron.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const server = await createServer({ root, configFile: path.join(root, 'vite.config.ts') });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`renderer: ${url}`);

let child = null;
let restarting = false;

function start() {
  child = spawn(electronPath, ['.', ...process.argv.slice(2)], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, VITE_DEV_SERVER_URL: url },
  });
  child.on('exit', (code) => {
    if (restarting) return;
    server.close();
    process.exit(code ?? 0);
  });
}

await watchElectron(() => {
  if (!child) return;
  restarting = true;
  child.once('exit', () => {
    restarting = false;
    start();
  });
  child.kill();
});

start();
