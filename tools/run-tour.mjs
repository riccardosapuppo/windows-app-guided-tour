#!/usr/bin/env node
/**
 * Starts the overlay on its own, without the application it teaches.
 *
 *     npm run tour
 *     npm run tour -- --tour tours/stock-control.json --poll-ms 600
 *
 * `npm start` starts both. This exists for two reasons.
 *
 * When something is wrong, one process at a time is far easier to look at than
 * two. And the tour is meant to be pointed at a **real** application, not only
 * at the invented one: `--tour` takes any tour file, and a tour file names
 * whichever window it is about.
 *
 * The overlay waits for that window rather than drawing over whatever happens
 * to be on the screen, so starting this on its own is a reasonable thing to do.
 * It sits there saying which window it is looking for until that window opens.
 */

import { startTheTour } from './parts.mjs';

const started = startTheTour(process.argv.slice(2));

if (!started.ok) {
  console.error(started.why);
  process.exit(2);
}

started.child.on('error', (error) => {
  console.error(`Electron would not start: ${error.message}`);
  process.exit(1);
});

started.child.on('exit', (code) => process.exit(code ?? 0));
