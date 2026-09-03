/**
 * The only bridge between the page and the machine.
 *
 * `contextIsolation` on and `nodeIntegration` off, so the renderer has no
 * require, no filesystem and no child processes — it has exactly the six verbs
 * below and nothing else. An overlay is a window sitting over everything
 * somebody does; the smaller its reach, the less there is to think about.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tour', {
  // From the main process: where to cut the hole, what to say, and whether the
  // step it is watching has finished.
  on: (what, then) => {
    // 'waiting' and 'attached' are the two that say whether the application
    // being taught is on the screen at all. Nothing is drawn between them.
    const allowed = ['tour', 'step', 'hole', 'lost', 'watching', 'finished', 'waiting', 'attached'];
    if (!allowed.includes(what)) return;
    ipcRenderer.on(what, (event, payload) => then(payload));
  },

  // The pointer moved on or off the card, so the overlay knows whether to
  // accept clicks or let them through to the application underneath.
  overTheCard: (over) => ipcRenderer.send('over-the-card', Boolean(over)),

  doIt: () => ipcRenderer.invoke('do-it'),
  skip: () => ipcRenderer.invoke('skip'),
  stop: () => ipcRenderer.invoke('stop'),
  openLog: () => ipcRenderer.invoke('open-log'),
});
