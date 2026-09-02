#!/usr/bin/env node
/**
 * Every tour, driven against the application it is about.
 *
 *     npm run demo          # the invented application, in another terminal
 *     npm run walkthrough
 *
 * The check that is not written behind the same door as the code. `npm test`
 * checks the tour format with invented readings, which makes it good at saying
 * the rules still hold and completely blind to the failure this project
 * actually has: **a tour that points at a control which is not there.**
 *
 * A mistyped automation id passes every unit test ever written. It fails at
 * step four, in front of the person the tour was written for, and the mistake
 * has been sitting in the file since the day it was written.
 *
 * So this opens the real application, and for every step of every tour:
 *
 *   - finds the control it points at, and confirms it is on the screen;
 *   - finds the control it watches, when that is a different one;
 *   - confirms a step marked "the tour can do this" is on something that can
 *     actually be invoked;
 *   - and then **does the whole tour**, playing the part of the person, and
 *     confirms every condition becomes true in turn.
 *
 * That last part is the one worth having. A tour whose steps all point at real
 * controls can still be a tour that cannot be finished — a condition waiting
 * on a phrase the application never says.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { accessibility } from '../src/locate/uia.js';
import { isFinished, watching, whatIsWrongWith, whatToRead } from '../src/tour/steps.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const TOURS = path.join(here, '..', 'tours');

/**
 * What the person types, for the steps a tour will not do.
 *
 * Keyed by the control, because that is what a step points at. A tour that
 * needed something cleverer than this would be a tour asking somebody to do
 * something a check cannot stand in for, which is worth knowing.
 */
const TYPED = {
  customer: 'Harbour Clinic',
  quantity: '2',
};

let checks = 0;
let failures = 0;

function expect(what, condition, detail) {
  checks += 1;
  if (condition) {
    console.log(`  ok    ${what}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${what}`);
    if (detail !== undefined) console.log(`        ${detail}`);
  }
}

const uia = accessibility();

async function main() {
  console.log('Driving every tour against the application it is about\n');

  if (!(await uia.available())) {
    console.log('UI Automation is not answering, so this check did not run.');
    console.log('It needs Windows. A check that could not run is not a check that failed.');
    process.exit(2);
  }

  const files = fs.readdirSync(TOURS).filter((one) => one.endsWith('.json'));
  expect('there are tours to check', files.length > 0, `${files.length} in tours/`);

  for (const file of files) {
    const tour = JSON.parse(fs.readFileSync(path.join(TOURS, file), 'utf8'));

    console.log(`\n${file} — "${tour.title}"`);

    expect('it is a valid tour', whatIsWrongWith(tour).length === 0, whatIsWrongWith(tour).join(' | '));

    const windows = await uia.windows();
    const open = windows.windows?.some((one) => one.title.includes(tour.window));

    if (!open) {
      expect(
        `the application it is about is open ("${tour.window}")`,
        false,
        `start it with: npm run demo — the windows on this desktop are: ${
          windows.windows?.map((one) => one.title).slice(0, 6).join(', ') ?? 'none'
        }`
      );
      continue;
    }

    expect(`the application it is about is open ("${tour.window}")`, true);

    // --------------------------------------- every step points at something real
    console.log('\n  Every step points at a control that exists');

    for (const step of tour.steps) {
      const found = await uia.find(tour.window, step.point);

      expect(
        `${step.id}: ${step.point.id ?? step.point.name} is there`,
        found.ok,
        found.why ?? 'not found — a mistyped id passes every unit test and fails in front of somebody'
      );

      if (!found.ok) continue;

      expect(
        `${step.id}: and it is on the screen, so a hole can be cut around it`,
        Boolean(found.element.rect),
        'the control exists and has no rectangle: scrolled out of view, collapsed, or on a tab that is not showing'
      );

      const target = watching(step);
      if (target.id !== step.point.id || target.name !== step.point.name) {
        const other = await uia.find(tour.window, target);
        expect(`${step.id}: and the control it WAITS on exists too`, other.ok, other.why);
      }

      if (step.canDo) {
        expect(
          `${step.id}: is marked "the tour can do this", and it can be invoked`,
          found.element.patterns.includes('Invoke'),
          `it supports ${found.element.patterns.join(', ') || 'nothing'} — a step the tour offers to do and cannot is a broken promise`
        );
      }
    }

    // ------------------------------------------------- and the tour can be finished
    console.log('\n  And the whole tour can actually be finished');

    // Back to a clean slate, so the run does not depend on what was on the
    // screen when this started.
    await uia.invoke(tour.window, { id: 'newOrder' });
    await pause(400);

    for (const step of tour.steps) {
      let did = 'nothing';

      if (step.canDo) {
        const done = await uia.invoke(tour.window, step.point);
        did = done.ok ? 'invoked' : `could not invoke: ${done.why}`;
      } else if (TYPED[step.point.id]) {
        // Playing the part of the person for the steps the tour declines to do.
        const done = await uia.type(tour.window, step.point, TYPED[step.point.id]);
        did = done.ok ? `typed "${TYPED[step.point.id]}"` : `could not type: ${done.why}`;
      }

      const finished = await waitUntilFinished(tour, step);

      expect(
        `${step.id}: finishes (${did})`,
        finished.done,
        `${finished.why} — a condition that never becomes true is a step nobody can leave`
      );
    }
  }

  // ------------------------------------------------------- what it refuses
  //
  // The paths a successful run never touches. Every one of them is something
  // that will happen to somebody: an application that is not running, a control
  // that has been renamed, a button that is greyed out. What matters is that
  // each is a sentence rather than a crash or a wait that never ends.
  console.log('\nWhat it says when it cannot do something');

  const noWindow = await uia.find('An application nobody has', { id: 'anything' });
  expect(
    'a window that is not open is named, not thrown',
    noWindow.ok === false && /no window whose title contains/.test(noWindow.why),
    JSON.stringify(noWindow)
  );

  const noControl = await uia.find('Stock control', { id: 'somethingRenamed' });
  expect(
    'a control that is not there says which was looked for',
    noControl.ok === false && /somethingRenamed/.test(noControl.why),
    noControl.why
  );

  const nothingNamed = await uia.find('Stock control', {});
  expect(
    'and asking for nothing at all is refused',
    nothingNamed.ok === false && /needs an id or a name/.test(nothingNamed.why),
    nothingNamed.why
  );

  // `printLabels` is greyed out until an order has been saved. Invoking a
  // disabled control silently does nothing, which is the failure that makes a
  // tour look broken while reporting success.
  await uia.invoke('Stock control', { id: 'newOrder' });
  await pause(400);

  const disabled = await uia.invoke('Stock control', { id: 'printLabels' });
  expect(
    'a control that is greyed out is refused rather than pressed into silence',
    disabled.ok === false && /disabled/.test(disabled.why),
    JSON.stringify(disabled)
  );

  const notTypable = await uia.type('Stock control', { id: 'saveOrder' }, 'nonsense');
  expect(
    'and a control that takes no value says which patterns it does support',
    notTypable.ok === false && /does not take a value/.test(notTypable.why),
    JSON.stringify(notTypable)
  );

  console.log('');
  if (failures > 0) {
    console.log(`${failures} of ${checks} checks failed.`);
    process.exit(1);
  }
  console.log(`All ${checks} checks passed.`);
}

/**
 * Waits for a step's condition, the way the tour does.
 *
 * With a limit, because the point of this check is that a condition which never
 * becomes true is reported rather than waited for. A tour that hangs on step
 * four is exactly what it exists to catch.
 */
async function waitUntilFinished(tour, step, timeoutMs = 5000) {
  const until = Date.now() + timeoutMs;
  const target = watching(step);
  let last = { done: false, why: 'nothing was read' };

  while (Date.now() < until) {
    const reading =
      whatToRead(step) === 'find' ? await uia.find(tour.window, target) : await uia.value(tour.window, target);

    last = isFinished(step, reading);
    if (last.done) return last;

    await pause(250);
  }

  return last;
}

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

main().catch((error) => {
  console.error(`\n${error.stack}`);
  process.exit(1);
});
