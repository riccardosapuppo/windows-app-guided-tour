#!/usr/bin/env node
/**
 * One command: the application, and the tour that teaches it.
 *
 *     npm start
 *     npm start -- --tour tours/stock-control.json --poll-ms 600
 *
 * This project needs two processes to show what it does, and a README whose
 * first instruction is "open a second terminal" is a README that gets skimmed.
 * Whoever is looking at this has a few minutes; the two-terminal version of it
 * is a manoeuvre, and manoeuvres do not get performed.
 *
 * They are still available on their own — `npm run tour` and `npm run demo` —
 * because when something is wrong it is much easier to look at one of them at a
 * time. That is what the separate commands are for, and the README says so in
 * that order: the one that works first, the ones that diagnose after.
 *
 * ── What starting two processes obliges you to do ────────────────────────────
 *
 * Three things, and skipping any of them is worse than not combining them:
 *
 *  1. **If one dies, the other stops.** A tour pointing at an application that
 *     has closed is the exact failure this project has already been caught
 *     making. A demo left running after the tour has gone is a window nobody
 *     owns that the next run fights with.
 *  2. **Closing takes the tree.** PowerShell hosting a WPF window and Electron
 *     hosting a renderer both have children; killing the parent alone leaves
 *     them behind.
 *  3. **Every line says where it came from.** Two processes writing to one
 *     terminal, unlabelled, is a log that cannot be read.
 */

import { startTheApplication, startTheTour, stopTree } from './parts.mjs';

const argv = process.argv.slice(2);

const application = startTheApplication({ stdio: ['ignore', 'pipe', 'pipe'], watchParent: true });

if (!application.ok) {
  console.error(`${application.why}.`);
  console.error('The parts that are not Windows — the tour format, the conditions — run anywhere:');
  console.error('  npm test');
  process.exit(2);
}

const tour = startTheTour(argv, { stdio: ['ignore', 'pipe', 'pipe'] });

if (!tour.ok) {
  console.error(tour.why);
  stopTree(application.child);
  process.exit(2);
}

const running = [application, tour];
let closing = false;

for (const one of running) {
  label(one.child.stdout, one.name);
  label(one.child.stderr, one.name);

  one.child.on('error', (error) => {
    console.error(`[${one.name}] would not start: ${error.message}`);
    closeEverything(1);
  });

  one.child.on('exit', (code) => {
    if (closing) return;
    // Zero or not, one of the two has finished and the other one is now
    // pointing at, or being pointed at by, nothing.
    console.error(`[${one.name}] stopped${code ? ` with code ${code}` : ''}, so this is stopping too.`);
    closeEverything(code ?? 0);
  });
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => closeEverything(0));
}

console.error('[both] the application and the tour are starting. Ctrl+C stops both.');

/**
 * Prefix each line with which process said it.
 *
 * By line rather than by chunk: the tour writes one JSON object per line and a
 * chunk boundary can fall in the middle of one, which would put the label into
 * the middle of a record and make the whole log unparseable.
 */
function label(stream, name) {
  if (!stream) return;

  let rest = '';

  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    const lines = (rest + chunk).split('\n');
    rest = lines.pop() ?? '';
    for (const line of lines) process.stdout.write(`[${name}] ${line}\n`);
  });

  stream.on('end', () => {
    if (rest) process.stdout.write(`[${name}] ${rest}\n`);
  });
}

function closeEverything(code) {
  if (closing) return;
  closing = true;

  for (const one of running) stopTree(one.child);

  // A moment for `taskkill` to be dispatched. Exiting the instant it is spawned
  // can kill the killer before it has done anything, which leaves exactly the
  // orphaned window this function exists to prevent.
  setTimeout(() => process.exit(code), 400);
}
