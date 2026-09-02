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
import { isFinished, watching, whatIsWrongWith, whatToRead } from '../src/tour/steps.js';

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
let watchingTimer = null;
let doneSoFar = [];

const uia = accessibility();

function say(level, message, detail = {}) {
  process.stdout.write(`${JSON.stringify({ at: new Date().toISOString(), level, message, ...detail })}\n`);
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

  overlay.webContents.send('tour', { title: tour.title, about: tour.about, steps: tour.steps.length });
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
  say('info', 'skipped', { step: step.id });
  doneSoFar.push({ step: step.id, how: 'skipped', at: new Date().toISOString() });
  await show(at + 1);
  return { ok: true };
});

ipcMain.handle('stop', () => {
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

/** Moves to a step: finds the control, draws the hole, and starts watching. */
async function show(next) {
  clearInterval(watchingTimer);
  at = next;

  if (at >= tour.steps.length) {
    overlay.webContents.send('finished', { steps: doneSoFar });
    say('info', 'the tour is finished', { steps: doneSoFar.length });
    return;
  }

  const step = tour.steps[at];

  overlay.webContents.send('step', {
    number: at + 1,
    of: tour.steps.length,
    id: step.id,
    say: step.say,
    canDo: Boolean(step.canDo),
    whyNot: step.whyNot ?? null,
  });

  await point(step);
  watchingTimer = setInterval(() => void look(step), pollMs);
}

/** Where the control is, in the overlay's own coordinates. */
async function point(step) {
  const found = await uia.find(tour.window, step.point);

  if (!found.ok || !found.element?.rect) {
    overlay.webContents.send('lost', {
      why: found.why ?? 'that control is not on the screen at the moment',
      looking: step.point,
      window: tour.window,
    });
    return;
  }

  overlay.webContents.send('hole', inDips(found.element.rect));
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

/** Is the step finished yet? Asked of the application, never assumed. */
async function look(step) {
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
    overlay.webContents.send('hole', inDips(reading.element.rect));
  }

  const said = isFinished(step, reading);
  overlay.webContents.send('watching', { why: said.why, done: said.done });

  if (!said.done) return;

  clearInterval(watchingTimer);
  doneSoFar.push({ step: step.id, how: 'done', why: said.why, at: new Date().toISOString() });
  say('info', 'step finished', { step: step.id, why: said.why });

  // A moment before moving on. Stepping the instant a value changes means the
  // person never sees what they just did.
  setTimeout(() => void show(at + 1), 700);
}
