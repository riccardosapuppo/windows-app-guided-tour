#!/usr/bin/env node
/**
 * The pictures in the README.
 *
 *     npm run screenshots
 *
 * **Nothing here photographs the screen.** That is the whole design of this
 * file, and it took four unusable attempts to arrive at.
 *
 * The obvious way to picture an overlay is to grab the desktop while it is up.
 * It works, and every frame is also a photograph of whatever else was open —
 * somebody's mail, somebody's editor, somebody's other windows. Those pictures
 * then go into a repository. Cropping to the application's own rectangle does
 * not help either: the card deliberately sits OUTSIDE the control it describes,
 * so any margin wide enough to include it is wide enough to include the
 * desktop behind.
 *
 * So each thing is captured from itself:
 *
 *   - the application, with `PrintWindow`, which asks a window to draw itself
 *     into a bitmap and ignores anything on top of it;
 *   - the overlay, with Electron's own `capturePage`, which renders the page
 *     and knows nothing about the desktop at all.
 *
 * Neither can capture something that was not asked for.
 */

import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '..');
const DOCS = path.join(root, 'docs');

fs.mkdirSync(DOCS, { recursive: true });

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

function powershell(script) {
  const file = path.join(root, 'capture.tmp.ps1');
  fs.writeFileSync(file, script);

  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', file],
      { timeout: 40_000 },
      (error, stdout, stderr) => {
        fs.rmSync(file, { force: true });
        resolve({ ok: !error, said: (stdout || stderr).trim() });
      }
    );
  });
}

/**
 * One window, drawing itself.
 *
 * `PrintWindow` with PW_RENDERFULLCONTENT (2) asks the window to paint into a
 * device context. It does not read the screen, so nothing that happens to be in
 * front of it — including this tour's own overlay — can end up in the picture.
 */
const printWindow = (title, out) => `
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public class Paint {
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
}
'@
$p = Get-Process | Where-Object MainWindowTitle -eq '${title}' | Select-Object -First 1
if (-not $p) { Write-Error 'window not found'; exit 1 }

$r = New-Object Paint+RECT
[Paint]::GetWindowRect($p.MainWindowHandle, [ref] $r) | Out-Null
$w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
if ($w -le 0 -or $h -le 0) { Write-Error 'the window has no size'; exit 1 }

$bmp = New-Object System.Drawing.Bitmap($w, $h)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$dc = $g.GetHdc()
# 2 is PW_RENDERFULLCONTENT, which is what makes this work for a window drawn
# with DirectX — which every WPF window is.
[Paint]::PrintWindow($p.MainWindowHandle, $dc, 2) | Out-Null
$g.ReleaseHdc($dc)
$bmp.Save('${out.replace(/\\/g, '\\\\')}', [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
'ok'
`;

console.log('Nothing here photographs the screen.\n');

// ------------------------------------------------------------ the application

console.log('  starting a fresh copy of the invented application');

await powershell("Get-Process | Where-Object MainWindowTitle -eq 'Stock control' | Stop-Process -Force");
await pause(1200);

const demo = spawn(
  'powershell.exe',
  ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', path.join(root, 'demo', 'stock.ps1')],
  { stdio: 'ignore' }
);

await pause(7000);

const drawn = await powershell(printWindow('Stock control', path.join(DOCS, 'the-application.png')));
console.log(drawn.ok ? '  docs/the-application.png' : `  the application would not draw itself: ${drawn.said}`);

demo.kill();
await powershell("Get-Process | Where-Object MainWindowTitle -eq 'Stock control' | Stop-Process -Force");

// ---------------------------------------------------------------- the overlay

console.log('  drawing the overlay on its own');

const electron = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe');
if (!fs.existsSync(electron)) {
  console.error('Electron is not installed here. npm install first.');
  process.exit(2);
}

// ELECTRON_RUN_AS_NODE has to go. Set — and some tools set it — Electron runs
// the file as plain Node, `require('electron')` returns a path string, and the
// main process dies on the first line.
const environment = { ...process.env };
delete environment.ELECTRON_RUN_AS_NODE;

await new Promise((done) => {
  const shot = spawn(electron, [path.join(here, 'draw-the-overlay.cjs')], {
    env: environment,
    stdio: 'inherit',
  });
  shot.on('exit', done);
});

console.log('\nEvery picture is of one thing, drawing itself.');
