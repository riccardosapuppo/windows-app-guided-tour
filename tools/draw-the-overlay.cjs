/**
 * The overlay, drawing itself into a PNG.
 *
 * An ordinary Electron window loading the same `overlay.html` the tour uses,
 * fed the same messages the main process sends, and captured with
 * `capturePage`. It renders the page and knows nothing about the desktop, so
 * there is nothing else that could end up in the picture.
 *
 * The window is opaque here and transparent in the tour, on purpose: a PNG of a
 * transparent overlay is a PNG of a card floating on nothing. The pale ground
 * stands in for the application underneath, and the dimming over it is the
 * thing being shown.
 */

const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const DOCS = path.join(root, 'docs');

const WIDE = 1000;
const TALL = 560;

/** Where a control would be, if this were over the application. */
const CONTROL = { x: 40, y: 66, width: 150, height: 44 };

app.whenReady().then(async () => {
  const window = new BrowserWindow({
    width: WIDE,
    height: TALL,
    show: false,
    backgroundColor: '#f3f5f7',
    webPreferences: {
      preload: path.join(root, 'tour', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  await window.loadFile(path.join(root, 'tour', 'overlay.html'));

  // A sketch of an application underneath, so the dimming has something to dim.
  // Drawn here rather than screenshotted: a picture of a real desktop is a
  // picture of everything on it.
  await window.webContents.insertCSS(`
    body::before {
      content: '';
      position: fixed;
      inset: 0;
      background:
        linear-gradient(#ffffff 0 56px, transparent 56px),
        linear-gradient(90deg, #e8ecef 0 1px, transparent 1px) 40px 66px / 150px 44px no-repeat,
        linear-gradient(#fff 0 0) 40px 66px / 150px 44px no-repeat,
        linear-gradient(#fff 0 0) 210px 66px / 150px 44px no-repeat,
        linear-gradient(#fff 0 0) 380px 66px / 150px 44px no-repeat,
        linear-gradient(#fff 0 0) 40px 170px / 300px 240px no-repeat,
        linear-gradient(#fff 0 0) 380px 170px / 570px 300px no-repeat,
        #f3f5f7;
      z-index: -1;
    }
  `);

  const send = (what, payload) => window.webContents.send(what, payload);

  send('tour', { title: 'Putting an order on the system', about: '', steps: 6 });
  send('step', {
    number: 1,
    of: 6,
    id: 'start-a-new-order',
    say: 'Start with a clean order. This clears anything left on the screen.',
    canDo: true,
    whyNot: null,
  });
  send('hole', CONTROL);
  send('watching', { done: false, why: 'it says "Ready. Everything in this window is invented."' });

  await new Promise((done) => setTimeout(done, 900));

  fs.writeFileSync(path.join(DOCS, 'the-overlay.png'), (await window.webContents.capturePage()).toPNG());
  console.log('  docs/the-overlay.png');

  // And a step the tour will not do for you, which is the other half of the
  // argument: it says so, and says why.
  send('step', {
    number: 2,
    of: 6,
    id: 'name-the-customer',
    say: 'Type who the order is for. Any name will do — everything here is invented.',
    canDo: false,
    whyNot: 'This one is typing, and typing is the step a tour should not do for you: you would not remember it.',
  });
  send('hole', { x: 60, y: 210, width: 260, height: 34 });
  send('watching', { done: false, why: 'it is "", not something' });

  await new Promise((done) => setTimeout(done, 700));

  fs.writeFileSync(path.join(DOCS, 'will-not-do-it.png'), (await window.webContents.capturePage()).toPNG());
  console.log('  docs/will-not-do-it.png');

  app.quit();
});
