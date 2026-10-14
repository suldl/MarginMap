// Bundles the Electron main and preload scripts with esbuild.
import { build, context } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const common = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['electron'],
  logLevel: 'warning',
  absWorkingDir: root,
};

const entries = [
  { entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.js' },
  { entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.js' },
];

export async function buildElectron() {
  await Promise.all(entries.map((e) => build({ ...common, ...e })));
}

/** Watch mode for `npm run dev`; `onRebuild` fires after every successful rebuild. */
export async function watchElectron(onRebuild) {
  let first = true;
  const ctxs = await Promise.all(
    entries.map((e) =>
      context({
        ...common,
        ...e,
        sourcemap: 'inline',
        plugins: [
          {
            name: 'notify',
            setup(b) {
              b.onEnd((result) => {
                if (!first && result.errors.length === 0) onRebuild();
              });
            },
          },
        ],
      }),
    ),
  );
  await Promise.all(ctxs.map((c) => c.rebuild()));
  first = false;
  await Promise.all(ctxs.map((c) => c.watch()));
  return ctxs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await buildElectron();
  console.log('electron: main + preload bundled');
}
