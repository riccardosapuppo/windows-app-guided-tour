/**
 * Does the overlay actually start?
 *
 * Run by `npm run build`, which is what "build" means for a project with
 * nothing to compile. A script that checks nothing so a gate goes green is
 * worse than no script; this loads the real page with the real preload, feeds
 * it the messages the main process sends, and reads back what the page did with
 * them.
 *
 * It catches the class of failure that a syntax check cannot: a preload that
 * exposes nothing, a page that throws on its first message, a selector that no
 * longer matches an element. Every one of those leaves an overlay that opens
 * and does nothing, which is the worst way for this to fail — it looks like it
 * is working.
 */

const { app, BrowserWindow } = require('electron');
const path = require('node:path');

const root = path.join(__dirname, '..');

let failures = 0;

function expect(what, condition, detail) {
  if (condition) {
    console.log(`  ok    ${what}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${what}`);
    if (detail !== undefined) console.log(`        ${detail}`);
  }
}

app.whenReady().then(async () => {
  const thrown = [];

  const window = new BrowserWindow({
    width: 900,
    height: 500,
    show: false,
    webPreferences: {
      preload: path.join(root, 'tour', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  window.webContents.on('console-message', (event, level, message) => {
    if (level >= 2) thrown.push(message);
  });
  window.webContents.on('render-process-gone', (event, details) => {
    thrown.push(`the page died: ${details.reason}`);
  });

  console.log('Starting the overlay for real\n');

  await window.loadFile(path.join(root, 'tour', 'overlay.html'));

  expect(
    'the page loads and the bridge is there',
    await window.webContents.executeJavaScript('typeof window.tour?.on === "function"'),
    'the preload exposed nothing, which is an overlay that opens and does nothing'
  );

  const send = (what, payload) => window.webContents.send(what, payload);

  send('tour', { title: 'A tour', about: 'about it', steps: 3 });
  send('step', { number: 2, of: 3, id: 'a-step', say: 'Press the thing.', canDo: true, whyNot: null });
  send('hole', { x: 100, y: 80, width: 160, height: 40 });
  send('watching', { done: false, why: 'it says "not yet"' });

  await new Promise((done) => setTimeout(done, 600));

  expect(
    'a step reaches the card',
    (await window.webContents.executeJavaScript('document.getElementById("say").textContent')) ===
      'Press the thing.'
  );

  expect(
    'and its number',
    (await window.webContents.executeJavaScript('document.getElementById("count").textContent')) === '2 of 3'
  );

  expect(
    'a hole moves the panes and shows the ring',
    (await window.webContents.executeJavaScript('!document.getElementById("ring").hidden')) &&
      (await window.webContents.executeJavaScript('document.getElementById("dimTop").style.height')) !== '',
    'the dimming is the design; panes that never move are a transparent window'
  );

  expect(
    'what it is waiting for is on the card',
    (await window.webContents.executeJavaScript('document.getElementById("watchingWhy").textContent')).includes(
      'not yet'
    ),
    'a tour that goes quiet while it waits looks like a tour that has stopped'
  );

  send('lost', { why: 'no window whose title contains that', window: 'Nothing', looking: {} });
  await new Promise((done) => setTimeout(done, 300));

  expect(
    'and a missing application is said out loud, not hidden',
    !(await window.webContents.executeJavaScript('document.getElementById("lost").hidden')),
    'a person can fix this by bringing a window forward, if they are told'
  );

  send('finished', { steps: [{ how: 'done' }, { how: 'skipped' }] });
  await new Promise((done) => setTimeout(done, 300));

  expect(
    'the end replaces the card rather than adding a dialog',
    (await window.webContents.executeJavaScript('document.getElementById("card").hidden')) &&
      !(await window.webContents.executeJavaScript('document.getElementById("done").hidden'))
  );

  expect('nothing threw along the way', thrown.length === 0, thrown.join(' | '));

  console.log('');
  console.log(failures > 0 ? `${failures} checks failed.` : 'The overlay starts, and does what it is told.');

  app.exit(failures > 0 ? 1 : 0);
});
