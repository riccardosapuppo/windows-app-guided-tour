#!/usr/bin/env node
/**
 * Starts the overlay.
 *
 *     npm start
 *     npm start -- --tour tours/stock-control.json --poll-ms 600
 *
 * A launcher rather than `electron tour/main.js` in `package.json`, for one
 * reason: `ELECTRON_RUN_AS_NODE`.
 *
 * When that is set in the environment — and some tools set it for every child
 * they spawn — the Electron binary behaves as a plain Node. `electron`'s main
 * export is then the PATH to the binary, a string, and the failure is inside
 * Node's own module loader:
 *
 *     TypeError: Cannot read properties of undefined (reading 'exports')
 *         at cjsPreparseModuleExports
 *
 * There is no way to catch that from inside `tour/main.js`, because it happens
 * while the imports are being linked and before a line of it runs. So it is
 * cleared here, where it can be.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const onWindows = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const elsewhere = path.join(root, 'node_modules', 'electron', 'dist', 'electron');
const binary = fs.existsSync(onWindows) ? onWindows : elsewhere;

if (!fs.existsSync(binary)) {
  console.error('Electron is not installed here. Run npm install first.');
  process.exit(2);
}

const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

// Whatever was after `npm start --` goes through, so `--tour` and `--poll-ms`
// work exactly as the README says they do.
const child = spawn(binary, [path.join(root, 'tour', 'main.js'), ...process.argv.slice(2)], {
  env: environment,
  stdio: 'inherit',
});

child.on('error', (error) => {
  console.error(`Electron would not start: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code) => process.exit(code ?? 0));
