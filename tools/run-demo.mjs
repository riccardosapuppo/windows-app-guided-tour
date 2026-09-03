#!/usr/bin/env node
/**
 * Starts the invented application on its own, without the tour.
 *
 *     npm run demo
 *
 * `npm start` starts both. This is here to look at the application by itself,
 * which is also how you check that a step's condition is something the
 * application really does rather than something the tour believes it does.
 */

import { startTheApplication } from './parts.mjs';

const started = startTheApplication();

if (!started.ok) {
  console.error(`${started.why}.`);
  console.error('The parts that are not Windows — the tour format, the conditions — run anywhere:');
  console.error('  npm test');
  process.exit(2);
}

started.child.on('error', (error) => {
  console.error(`PowerShell would not start: ${error.message}`);
  process.exit(1);
});

started.child.on('exit', (code) => process.exit(code ?? 0));
