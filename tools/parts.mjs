/**
 * The two processes this project is made of, and how to start each one.
 *
 * Extracted here because there are now three launchers — the tour on its own,
 * the application on its own, and both together — and three copies of "how to
 * start Electron" would be three copies that drift. The awkward knowledge about
 * each one is written down once, in the function that starts it.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const root = path.join(here, '..');

/**
 * The invented application that the tour teaches.
 *
 * `-STA` is not optional: a WPF window cannot be created on a multi-threaded
 * apartment, and without it the failure is an exception about apartment state
 * that means nothing to anybody reading it.
 */
export function startTheApplication({ stdio = 'inherit', watchParent = false } = {}) {
  if (process.platform !== 'win32') {
    return { ok: false, why: `the application being taught is a Windows one, and this is ${process.platform}` };
  }

  const argv = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', path.join(root, 'demo', 'stock.ps1')];

  // `-ParentPid` makes the window close itself if whoever started it goes away.
  //
  // `stopTree` handles every orderly exit, but there is no orderly exit when
  // somebody closes the terminal — and closing the terminal is how most people
  // stop a thing. Without this, that leaves a window on the screen owned by
  // nothing, holding the very title the tour searches for, so the next run
  // attaches to the corpse of the last one.
  if (watchParent) argv.push('-ParentPid', String(process.pid));

  const child = spawn('powershell.exe', argv, { stdio });

  return { ok: true, child, name: 'the application' };
}

/**
 * The overlay.
 *
 * `ELECTRON_RUN_AS_NODE` makes the Electron binary behave as a plain Node, and
 * some tools set it for every child they spawn. When it is set, `electron`'s
 * main export is the PATH to the binary — a string — and the failure happens
 * inside Node's module loader while the imports are being linked, before a line
 * of `tour/main.js` runs. There is no way to catch it from in there, so it is
 * cleared out here, where it can be.
 */
export function startTheTour(argv = [], { stdio = 'inherit' } = {}) {
  const onWindows = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
  const elsewhere = path.join(root, 'node_modules', 'electron', 'dist', 'electron');
  const binary = fs.existsSync(onWindows) ? onWindows : elsewhere;

  if (!fs.existsSync(binary)) {
    return { ok: false, why: 'Electron is not installed here. Run npm install first.' };
  }

  const environment = { ...process.env };
  delete environment.ELECTRON_RUN_AS_NODE;

  const child = spawn(binary, [path.join(root, 'tour', 'main.js'), ...argv], { env: environment, stdio });

  return { ok: true, child, name: 'the tour' };
}

/**
 * Kill a process and everything it started.
 *
 * `child.kill()` on Windows kills the one process. PowerShell running a WPF
 * window, and Electron running a renderer, both have children of their own —
 * so a launcher that stops "cleanly" can leave a window on the screen that
 * nothing owns and the next run fights with. `taskkill /T` takes the tree.
 */
export function stopTree(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;

  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => {
      child.kill();
    });
    return;
  }

  child.kill();
}
