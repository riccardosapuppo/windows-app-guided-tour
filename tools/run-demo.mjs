#!/usr/bin/env node
/**
 * Starts the invented application.
 *
 *     npm run demo
 *
 * A launcher rather than the PowerShell line in `package.json`, for two
 * reasons. It needs `-STA` — a WPF window cannot be created on a
 * multi-threaded apartment and the failure is an exception about apartment
 * state that says nothing to anybody. And on anything that is not Windows it
 * can say so in a sentence, rather than failing with "powershell: not found".
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, '..', 'demo', 'stock.ps1');

if (process.platform !== 'win32') {
  console.error('The application being taught is a Windows one, and this is', `${process.platform}.`);
  console.error('The parts that are not Windows — the tour format, the conditions — run anywhere:');
  console.error('  npm test');
  process.exit(2);
}

const child = spawn(
  'powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', script],
  { stdio: 'inherit' }
);

child.on('error', (error) => {
  console.error(`PowerShell would not start: ${error.message}`);
  process.exit(1);
});

child.on('exit', (code) => process.exit(code ?? 0));
