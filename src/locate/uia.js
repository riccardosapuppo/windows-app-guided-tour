/**
 * The Node side of the accessibility bridge.
 *
 * Spawns `scripts/uia.ps1`, one command per call, and reads a line of JSON
 * back. Nothing else in this project knows that Windows is involved.
 *
 * Everything a step needs comes through the four verbs below, and each one is
 * a question the tour genuinely has to ask:
 *
 *   `windows()`   is the application even running?
 *   `find()`      where is this control, right now, on the screen?
 *   `value()`     what is in it — so a step can be finished by the person
 *                 rather than by the tour claiming it was.
 *   `invoke()`    press it, when the tour has been asked to do the step.
 *
 * The rectangle that comes back is in **physical pixels**, which is what UI
 * Automation deals in. Electron places windows in device-independent ones.
 * Converting between them is not optional — see the comment in
 * `tour/overlay.js`, where the failure is a hole in the wrong place on any
 * display that is not at 100%.
 */

import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(here, '..', '..', 'scripts', 'uia.ps1');

/**
 * @param {object} options
 * @param {string} [options.powershell] which shell to run. Windows PowerShell
 *   by name, so this uses whatever is on the path rather than a hard-coded path.
 */
export function accessibility({ powershell = 'powershell.exe', script = SCRIPT, timeoutMs = 15_000 } = {}) {
  function ask(command, args = {}) {
    const argv = [
      '-NoProfile',
      '-NonInteractive',
      // The script is in this repository and is read-only; bypassing the policy
      // for THIS file is not the same as changing the machine's policy, which
      // this must never do.
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      script,
      '-Command',
      command,
    ];

    for (const [name, value] of Object.entries(args)) {
      if (value === undefined || value === null || value === '') continue;
      argv.push(`-${name}`, String(value));
    }

    return new Promise((resolve) => {
      execFile(powershell, argv, { timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
        if (error && !stdout) {
          return resolve({
            ok: false,
            why:
              error.code === 'ENOENT'
                ? 'PowerShell was not found, so this can only run on Windows'
                : `the helper would not run: ${error.message.split('\n')[0]}`,
            detail: stderr?.trim() || null,
          });
        }

        // The helper writes exactly one line of JSON. Anything else is a
        // PowerShell error that reached standard output, and reporting it as
        // it came is more use than "could not parse".
        try {
          resolve(JSON.parse(stdout.trim().split('\n').at(-1)));
        } catch {
          resolve({
            ok: false,
            why: 'the helper did not answer with JSON',
            detail: (stdout || stderr).trim().slice(0, 400),
          });
        }
      });
    });
  }

  return {
    windows: () => ask('windows'),
    describe: (window) => ask('describe', { Window: window }),
    find: (window, { id, name } = {}) => ask('find', { Window: window, Id: id, Name: name }),
    value: (window, { id, name } = {}) => ask('value', { Window: window, Id: id, Name: name }),
    invoke: (window, { id, name } = {}) => ask('invoke', { Window: window, Id: id, Name: name }),

    /**
     * Puts a value in a control, for whatever is playing the part of the
     * person. The tour itself does not use this: a step that types for you is
     * a step you will not remember.
     */
    type: (window, { id, name } = {}, text = '') =>
      ask('type', { Window: window, Id: id, Name: name, Text: text }),
    focus: (window) => ask('focus', { Window: window }),

    /** Is there anything to talk to at all. Asked once, at the start. */
    async available() {
      const said = await ask('windows');
      return said.ok === true;
    },
  };
}
