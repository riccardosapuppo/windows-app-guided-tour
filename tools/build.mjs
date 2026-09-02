#!/usr/bin/env node
/**
 * "Build", for a project with nothing to compile.
 *
 *     npm run build
 *
 * There is no bundler here and no transpiler, so the honest thing a build can
 * do is start the artefact and see whether it works. A build script that checks
 * nothing so that a gate goes green is worse than no build script.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
const elsewhere = path.join(root, 'node_modules', 'electron', 'dist', 'electron');
const binary = fs.existsSync(electron) ? electron : elsewhere;

if (!fs.existsSync(binary)) {
  console.error('Electron is not installed here, so the overlay cannot be started.');
  console.error('npm install first. A check that could not run is not a check that failed.');
  process.exit(2);
}

// ELECTRON_RUN_AS_NODE has to go. Set — and some tools set it — Electron runs
// the file as plain Node, `require("electron")` gives back a path string, and
// the main process dies on its first line.
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

const child = spawn(binary, [path.join(here, 'does-it-start.cjs')], {
  env: environment,
  stdio: 'inherit',
});

child.on('exit', (code) => process.exit(code ?? 1));
