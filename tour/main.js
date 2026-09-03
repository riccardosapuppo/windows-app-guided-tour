/**
 * The overlay: a window over the whole screen that is not in the way.
 *
 *     npm start -- --tour tours/stock-control.json
 *
 * Three things have to be true at once, and each fights the other two.
 *
 * **It has to cover everything**, because the dimming is what makes the one
 * control obvious. **It has to be invisible to the mouse**, because the person
 * is meant to use the application underneath, not the tour. And **its own card
 * has to be clickable**, because that is where the buttons are.
 *
 * `setIgnoreMouseEvents(true, { forward: true })` does the second and the third
 * together: the window ignores the mouse but still hears where it is, so the
 * renderer can say "the pointer is over the card now" and the main process can
 * stop ignoring for as long as that is true. Without `forward`, the window
 * hears nothing and can never turn itself back on.
 *
 * The rest of this file is the coordinate problem. UI Automation answers in
 * physical pixels; Electron places windows in device-independent ones. On a
 * display at 100% they are the same number and everything appears to work,
 * which is exactly why it is worth writing down: at 150%, which is the default
 * on most laptops sold in the last five years, the hole is drawn two thirds of
 * the way towards the top left of where the control actually is.
 */

import { app, BrowserWindow, ipcMain, screen, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { accessibility } from '../src/locate/uia.js';
import { oneAtATime } from '../src/tour/one-at-a-time.js';
import { isFinished, watching, whatIsWrongWith, whatToRead } from '../src/tour/steps.js';

/**
 * Running under Node instead of Electron, which is a sentence rather than a
 * stack trace.
 *
 * `ELECTRON_RUN_AS_NODE` makes the Electron binary behave as a plain Node, and
 * some tools set it in the environment they hand to their children. When it is
 * set, `import { app } from 'electron'` gives back the PATH to the binary — a
 * string — and the first line that touches it dies on
 * "Cannot read properties of undefined (reading 'whenReady')".
 *
 * That message sent me looking for a bug in this file for twenty minutes. It is
 * two lines to say what actually happened.
 */
if (typeof app?.whenReady !== 'function') {
  console.error('This is being run as plain Node rather than as Electron.');
  console.error(
    process.env.ELECTRON_RUN_AS_NODE
      ? 'ELECTRON_RUN_AS_NODE is set in this environment. Unset it and try again.'
      : 'Start it with `npm start`, which runs it under Electron.'
  );
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');

function argument(name, fallback) {
  const at = process.argv.indexOf(`--${name}`);
  return at !== -1 && process.argv[at + 1] ? process.argv[at + 1] : fallback;
}

const tourFile = path.resolve(argument('tour', path.join(root, 'tours', 'stock-control.json')));
const pollMs = Number(argument('poll-ms', 600));

let overlay = null;
let tour = null;
let at = 0;
let doneSoFar = [];

/**
 * ── The state that stops a tour from telling itself it has finished ──────────
 *
 * The first version watched a step with `setInterval(() => void look(step), 600)`,
 * and `look` is asynchronous: it reads a control across a process boundary,
 * which takes longer than 600 milliseconds more often than not. So several
 * `look`s ran at once. Every one of them read the same finished condition,
 * every one of them announced it, and every one of them queued an advance.
 *
 * What that looked like from outside — from a real log, not a thought
 * experiment:
 *
 *     step finished  start-a-new-order      (six times)
 *     stopped        finished: 6, of: 6
 *
 * Six steps done of six, while the second one had never begun. The person
 * watching saw the tour freeze on step one and then declare victory. And when
 * they closed it, a `setTimeout` still in flight called into the window that
 * had just been destroyed: `TypeError: Object has been destroyed`.
 *
 * Three things are needed, and none of them is enough alone:
 *
 *  1. A **latch** — a generation that changes whenever the step changes or the
 *     tour stops, so anything returning from an await can tell it is out of
 *     date. Without it, merely not overlapping would not be enough: two
 *     consecutive polls of an already-finished step would still advance twice.
 *
 *  2. **No overlap** — the next poll scheduled after the last one returned,
 *     rather than on an interval that assumes the body is faster than it is.
 *
 *  3. **Stopping stops everything**, and every message to the window behind a
 *     check that the window is still there. The mirror image of "do not close a
 *     thing still in use": do not use a thing already closed.
 *
 * The first two live in `src/tour/one-at-a-time.js`, and they live there rather
 * than here for a reason worth more than the tidiness: this file imports
 * Electron and so cannot be tested, and that rule is the one worth a test. It
 * has six, driven by a clock they control, and the first of them fails against
 * the version that was wrong.
 */
const steps = oneAtATime({ every: pollMs });

/** The pause between a step finishing and the next one appearing. */
let advanceTimer = null;

/**
 * Whether the application being taught is actually on the screen.
 *
 * Nothing is drawn while this is false. A tour that dims the screen and cuts a
 * hole where a button would be *if* the application were running is not a rough
 * guide — it is pointing confidently at somebody else's window. So until the
 * target is found, the overlay says which window it is waiting for and keeps
 * looking; and if the window disappears half way through, the tour goes back to
 * waiting rather than carrying on indicating nothing.
 */
let attached = false;

const uia = accessibility();

function say(level, message, detail = {}) {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), level, message, ...detail })}\n`);
}

/**
 * The only way anything reaches the overlay.
 *
 * Every `send` is guarded, rather than the interesting ones: a guard that has
 * to be remembered is a guard that will be forgotten at the one call site that
 * runs after teardown.
 */
function send(channel, payload) {
  if (steps.stopped || !overlay || overlay.isDestroyed() || overlay.webContents.isDestroyed()) return;
  overlay.webContents.send(channel, payload);
}

/** Nothing pending, whatever was pending. Called before every change of state. */
function cancelPending() {
  clearTimeout(advanceTimer);
  advanceTimer = null;
}

function pause(ms) {
  return new Promise((done) => setTimeout(done, ms));
}

/**
 * Is the window being taught on the screen?
 *
 * Matched by substring, the same way the helper matches it, because a window is
 * called "Stock control" until somebody opens an order and then it is called
 * "Stock control — order 4471". A tour written against the exact title stops
 * matching the moment the person does the thing it asked them to do.
 */
async function theWindowIsThere() {
  const said = await uia.windows();
  if (!said?.ok) return { there: false, why: said?.why ?? 'the helper did not answer' };

  const wanted = String(tour.window ?? '').toLowerCase();
  const there = (said.windows ?? []).some((one) => String(one.title ?? '').toLowerCase().includes(wanted));

  return { there, why: there ? null : `no window with "${tour.window}" in its title is open` };
}

app.whenReady().then(start);

app.on('window-all-closed', () => app.quit());

async function start() {
  try {
    tour = JSON.parse(fs.readFileSync(tourFile, 'utf8'));
  } catch (error) {
    say('error', 'that tour could not be read', { file: tourFile, detail: error.message });
    return app.quit();
  }

  // Checked before a window is opened, not as the steps go by. A tour with a
  // mistyped id fails at step seven, in front of the person it was meant to
  // help, and the mistake was there all along.
  const wrong = whatIsWrongWith(tour);
  if (wrong.length > 0) {
    say('error', 'that tour has mistakes in it', { file: tourFile, wrong });
    return app.quit();
  }

  const display = screen.getPrimaryDisplay();

  overlay = new BrowserWindow({
    ...display.bounds,
    frame: false,
    transparent: true,
    // Above ordinary windows but below anything the system puts on top. A tour
    // that sits over a security prompt is a tour that has to be killed.
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    hasShadow: false,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.setIgnoreMouseEvents(true, { forward: true });
  await overlay.loadFile(path.join(here, 'overlay.html'));

  say('info', 'the tour is up', { tour: tour.title, steps: tour.steps.length, window: tour.window });

  send('tour', {
    title: tour.title,
    about: tour.about,
    steps: tour.steps.length,
    // Read from package.json rather than written down twice. A version in two
    // places is a version that is wrong in one of them.
    version: JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version,
  });
  await show(0);
}

/** The pointer is over the card, so the overlay has to accept clicks again. */
ipcMain.on('over-the-card', (event, over) => {
  overlay?.setIgnoreMouseEvents(!over, { forward: true });
});

ipcMain.handle('do-it', async () => {
  const step = tour.steps[at];
  if (!step?.canDo) return { ok: false, why: step?.whyNot ?? 'this step is not one the tour will do' };

  // Focus first. Invoking a control in a window that is behind another one
  // works, and the person watching sees nothing happen — which is worse than a
  // failure, because they conclude the tour is broken.
  await uia.focus(tour.window);
  const did = await uia.invoke(tour.window, step.point);

  say(did.ok ? 'info' : 'warn', did.ok ? 'did the step' : 'could not do the step', {
    step: step.id,
    why: did.why ?? null,
  });

  return did;
});

ipcMain.handle('skip', async () => {
  const step = tour.steps[at];
  if (!step) return { ok: false, why: 'the tour is not on a step' };

  // Close the latch before anything else. A poll of this step that is already
  // in flight will come back, see it is a generation behind, and stop — which
  // is what keeps a skip from racing an advance and losing a step.
  steps.interrupt();
  cancelPending();

  say('info', 'skipped', { step: step.id });
  doneSoFar.push({ step: step.id, how: 'skipped', at: new Date().toISOString() });
  await show(at + 1);
  return { ok: true };
});

ipcMain.handle('stop', () => {
  // In this order: nothing more may act or be sent, nothing is pending. Then
  // quit. The reverse order is how a timer fires into a destroyed window.
  steps.stop();
  cancelPending();

  say('info', 'stopped', { finished: doneSoFar.length, of: tour.steps.length });
  app.quit();
  return { ok: true };
});

ipcMain.handle('open-log', () => {
  const file = path.join(root, 'tour-log.json');
  fs.writeFileSync(file, JSON.stringify({ tour: tour.title, steps: doneSoFar }, null, 2));
  shell.showItemInFolder(file);
  return { ok: true, file };
});

/** Moves to a step: waits for the window, finds the control, starts watching. */
async function show(next) {
  cancelPending();
  const mine = steps.interrupt();
  at = next;

  if (at >= tour.steps.length) {
    send('finished', { steps: doneSoFar });
    say('info', 'the tour is finished', { steps: doneSoFar.length });
    return;
  }

  // Before anything is drawn. Until the application is on the screen there is
  // nothing to point at, and a hole cut over whatever happens to be there
  // instead is worse than an empty screen: it is an assertion, and a false one.
  if (!(await waitForTheWindow(mine))) return;

  const step = tour.steps[at];

  send('step', {
    number: at + 1,
    of: tour.steps.length,
    id: step.id,
    say: step.say,
    canDo: Boolean(step.canDo),
    whyNot: step.whyNot ?? null,
  });

  await point(step);
  if (!steps.holds(mine)) return;

  steps.watch(
    (polls) => look(step, polls),
    (said) => finished(step, said)
  );
}

/** A step is done: record it, say so, and move on after a moment. */
function finished(step, said) {
  doneSoFar.push({ step: step.id, how: 'done', why: said.why, at: new Date().toISOString() });
  say('info', 'step finished', { step: step.id, why: said.why });

  // A moment before moving on. Stepping the instant a value changes means the
  // person never sees what they just did.
  advanceTimer = setTimeout(() => void show(at + 1), 700);
}

/**
 * Wait until the window being taught is on the screen. Returns false if the
 * tour moved on or stopped while waiting.
 *
 * This loop is also where the tour comes back to when the application is closed
 * half way through, which is a thing people do. The alternative — carrying on
 * and reporting "that control is not on the screen at the moment" once per
 * poll — describes the symptom and not the cause, and leaves the dimming and
 * the hole exactly where they were, over somebody else's desktop.
 */
async function waitForTheWindow(mine) {
  // Said once per spell of waiting, not once per poll. A line every 600ms is a
  // log nobody reads, and the one line that matters — "it came back" — would be
  // buried in it.
  let told = false;

  for (;;) {
    if (!steps.holds(mine)) return false;

    const said = await theWindowIsThere();
    if (!steps.holds(mine)) return false;

    if (said.there) {
      if (!attached || told) {
        attached = true;
        say('info', 'the window is there, starting', { window: tour.window });
        send('attached', { window: tour.window });
      }
      return true;
    }

    if (attached) {
      attached = false;
      say('warn', 'the window has gone: waiting for it to come back', { window: tour.window });
      told = true;
    } else if (!told) {
      say('info', 'waiting for the window before anything is drawn', {
        window: tour.window,
        why: said.why,
      });
      told = true;
    }

    send('waiting', { window: tour.window, why: said.why });
    await pause(pollMs);
  }
}

/** Where the control is, in the overlay's own coordinates. */
async function point(step) {
  const found = await uia.find(tour.window, step.point);

  if (!found.ok || !found.element?.rect) {
    send('lost', {
      why: found.why ?? 'that control is not on the screen at the moment',
      looking: step.point,
      window: tour.window,
    });
    return;
  }

  send('hole', inDips(found.element.rect));
}

/**
 * Physical pixels to device-independent ones.
 *
 * The whole reason this function exists. UI Automation reports where a control
 * is in real screen pixels; a browser window inside Electron is laid out in
 * device-independent ones, and the two are the same number only on a display at
 * 100%. At 150% — the factory setting on most laptops — a hole drawn from the
 * physical rectangle lands two thirds of the way towards the top left of the
 * control, and the tour points confidently at nothing.
 *
 * `screenToDipRect` also handles the second display being at a different scale,
 * which no amount of dividing by one number does.
 */
/** Two locators naming the same control. */
function sameControl(a, b) {
  return (a?.id ?? null) === (b?.id ?? null) && (a?.name ?? null) === (b?.name ?? null);
}

function inDips(rect) {
  const dip = screen.screenToDipRect(overlay, rect);
  const bounds = overlay.getBounds();

  // Relative to the overlay, since the renderer draws in its own box.
  return {
    x: Math.round(dip.x - bounds.x),
    y: Math.round(dip.y - bounds.y),
    width: Math.round(dip.width),
    height: Math.round(dip.height),
  };
}

/**
 * One reading. Returns what `oneAtATime` needs: `{ done, why }`.
 *
 * The scheduling — never two at once, at most one finish, nothing after a stop
 * — is not here. It is in `src/tour/one-at-a-time.js`, which has tests. This
 * function only has to be a question asked once.
 *
 * `polls` counts how long this step has been watched, and exists only so the
 * window can be re-checked every few seconds rather than on every read. That
 * has to be on a schedule of its own: a step whose condition is `gone` succeeds
 * by failing to find its control, so "check the window whenever the read fails"
 * would spawn a process on every single poll of one.
 */
async function look(step, polls) {
  // Every few seconds, has the application gone away? If it has, the answer is
  // not to keep pointing at where it used to be.
  const everyFewSeconds = Math.max(1, Math.round(3000 / pollMs));

  if (polls > 0 && polls % everyFewSeconds === 0) {
    const still = await theWindowIsThere();

    if (!still.there) {
      say('warn', 'the window has gone while a step was being watched', { step: step.id });
      cancelPending();
      // `show(at)` takes a new generation, which stops this watch, and re-enters
      // the waiting loop on the SAME step — so when the application comes back
      // the person is where they left off rather than at the beginning.
      void show(at);
      return { done: false, why: 'the application is not on the screen' };
    }
  }

  const target = watching(step);
  const reading =
    whatToRead(step) === 'find' ? await uia.find(tour.window, target) : await uia.value(tour.window, target);

  /**
   * The control being POINTED at, which is often not the one being watched.
   *
   * "Type a customer, and Save lights up" points at the text box and waits on
   * the button. "Press New order" points at the button and waits on the status
   * line at the bottom of the window.
   *
   * The first version re-pointed at whatever it had just read, and on that
   * second step the hole slid down to the status line the moment the tour
   * started watching — a confident spotlight on the wrong control, which is
   * worse than no spotlight at all.
   */
  if (!sameControl(target, step.point)) {
    await point(step);
  } else if (reading.ok && reading.element?.rect) {
    // Same control, and it has just been read: use that rather than asking
    // again. A window being dragged moves several times a second and this is
    // already a process boundary per poll.
    send('hole', inDips(reading.element.rect));
  }

  const said = isFinished(step, reading);
  send('watching', { why: said.why, done: said.done });

  return said;
}
