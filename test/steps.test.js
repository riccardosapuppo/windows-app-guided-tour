import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import { isFinished, watching, whatIsWrongWith, whatToRead } from '../src/tour/steps.js';

const here = path.dirname(fileURLToPath(import.meta.url));

/** A step that is complete, so each test can spoil exactly one thing. */
const aStep = (over = {}) => ({
  id: 'press-save',
  say: 'Press Save.',
  point: { id: 'saveOrder' },
  done: { when: 'says', of: { id: 'status' }, contains: 'Saved as' },
  ...over,
});

describe('reading a tour before anybody sees it', () => {
  it('accepts one that is complete', () => {
    assert.deepEqual(whatIsWrongWith({ window: 'Stock control', steps: [aStep()] }), []);
  });

  it('refuses a step that cannot be finished', () => {
    // The one that matters most. A step with no condition is a step nobody can
    // leave, and it is discovered by somebody sitting in front of it.
    const wrong = whatIsWrongWith({ window: 'x', steps: [aStep({ done: undefined })] });
    assert.match(wrong.join(' '), /how it will know it is finished/);
  });

  it('refuses a condition it cannot wait for, and says what it knows', () => {
    const wrong = whatIsWrongWith({ window: 'x', steps: [aStep({ done: { when: 'clicked' } })] });

    assert.match(wrong.join(' '), /"clicked" is not something this can wait for/);
    assert.match(wrong.join(' '), /value, enabled, says, gone/);
  });

  it('refuses a step that points at nothing', () => {
    const wrong = whatIsWrongWith({ window: 'x', steps: [aStep({ point: {} })] });
    assert.match(wrong.join(' '), /point at a control/);
  });

  it('refuses two steps that share an id', () => {
    // Ids name steps in the log. Two the same means a log nobody can read.
    const wrong = whatIsWrongWith({ window: 'x', steps: [aStep(), aStep()] });
    assert.match(wrong.join(' '), /share the id/);
  });

  it('refuses a value condition with nothing to compare against', () => {
    const wrong = whatIsWrongWith({ window: 'x', steps: [aStep({ done: { when: 'value' } })] });
    assert.match(wrong.join(' '), /needs "is", "contains" or "matches"/);
  });

  it('refuses a tour with no steps, and one that is not a tour at all', () => {
    assert.match(whatIsWrongWith({ window: 'x', steps: [] }).join(' '), /no steps/);
    assert.match(whatIsWrongWith(null).join(' '), /has to be an object/);
  });

  it('finds every mistake at once, rather than the first', () => {
    // Somebody writing a tour fixes what they are told about. Reporting one
    // mistake per run is four runs to fix four mistakes.
    const wrong = whatIsWrongWith({
      steps: [{ say: 'do it' }, { id: 'two', point: { id: 'a' } }],
    });

    assert.ok(wrong.length >= 4, wrong.join(' | '));
  });
});

describe('knowing a step is finished', () => {
  it('waits for text to say what it should', () => {
    const step = aStep();

    assert.equal(isFinished(step, { ok: true, value: 'Ready.' }).done, false);
    assert.equal(isFinished(step, { ok: true, value: 'Saved as SO-41220.' }).done, true);
  });

  it('is not case-fussy about it', () => {
    // A status line's capitalisation is not something a tour should depend on.
    const step = aStep({ done: { when: 'says', contains: 'saved as' } });
    assert.equal(isFinished(step, { ok: true, value: 'Saved As SO-1' }).done, true);
  });

  it('waits for a control to stop being greyed out', () => {
    const step = aStep({ done: { when: 'enabled', of: { id: 'saveOrder' } } });

    assert.equal(isFinished(step, { ok: true, element: { enabled: false } }).done, false);
    assert.equal(isFinished(step, { ok: true, element: { enabled: true } }).done, true);
  });

  it('waits for something to be gone, and only then treats missing as finished', () => {
    const gone = aStep({ done: { when: 'gone', of: { id: 'dialog' } } });

    assert.equal(isFinished(gone, { ok: true, element: {} }).done, false);
    assert.equal(isFinished(gone, { ok: false, why: 'not found' }).done, true);
  });

  it('does NOT treat a control it cannot find as a finished step', () => {
    // The race this exists to prevent: a window that has not finished drawing
    // has none of its controls, and a tour that reads "missing" as "done" runs
    // through every step in a second and teaches nobody anything.
    const step = aStep();
    const said = isFinished(step, { ok: false, why: 'no window whose title contains that' });

    assert.equal(said.done, false);
    assert.match(said.why, /no window/);
  });

  it('matches a value exactly when asked to', () => {
    const step = aStep({ done: { when: 'value', is: '3' } });

    assert.equal(isFinished(step, { ok: true, value: '3' }).done, true);
    assert.equal(isFinished(step, { ok: true, value: '30' }).done, false);
  });

  it('matches a shape when the value cannot be known in advance', () => {
    // A generated reference, a date, a quantity somebody chose. There is no
    // literal to compare against and "not empty" is the actual requirement.
    const step = aStep({ done: { when: 'value', matches: '\\S{2,}' } });

    assert.equal(isFinished(step, { ok: true, value: '' }).done, false);
    assert.equal(isFinished(step, { ok: true, value: ' ' }).done, false);
    assert.equal(isFinished(step, { ok: true, value: 'Harbour Clinic' }).done, true);
  });

  it('says a bad pattern is a bad pattern, rather than never finishing', () => {
    // Otherwise a typo in a tour looks exactly like a person who will not do
    // the step, and somebody sits waiting for a condition that cannot be met.
    const step = aStep({ done: { when: 'value', matches: '([unclosed' } });
    const said = isFinished(step, { ok: true, value: 'anything' });

    assert.equal(said.done, false);
    assert.match(said.why, /pattern that is not one/);
  });

  it('carries the reason either way, so the card can show it', () => {
    const step = aStep();
    assert.match(isFinished(step, { ok: true, value: 'Ready.' }).why, /Ready\./);
    assert.match(isFinished(step, { ok: true, value: 'Saved as SO-1' }).why, /Saved as/);
  });
});

describe('which control a step is about', () => {
  it('watches what it points at, when they are the same', () => {
    const step = aStep({ done: { when: 'value', contains: 'x' } });
    assert.deepEqual(watching(step), { id: 'saveOrder' });
  });

  it('watches something else when the step says so', () => {
    // "Type a customer, and Save lights up" points at the box and waits on the
    // button. Conflating the two put the spotlight on the status line.
    assert.deepEqual(watching(aStep()), { id: 'status' });
  });

  it('asks for the reading each condition actually needs', () => {
    assert.equal(whatToRead(aStep({ done: { when: 'enabled', of: { id: 'a' } } })), 'find');
    assert.equal(whatToRead(aStep({ done: { when: 'gone', of: { id: 'a' } } })), 'find');
    assert.equal(whatToRead(aStep({ done: { when: 'value', is: 'a' } })), 'value');
    assert.equal(whatToRead(aStep()), 'value');
  });
});

describe('the tours in this repository', () => {
  it('are all valid, checked here rather than when somebody runs one', () => {
    const folder = path.join(here, '..', 'tours');
    const files = fs.readdirSync(folder).filter((one) => one.endsWith('.json'));

    assert.ok(files.length > 0, 'there are no tours to check, which is not a passing test');

    for (const file of files) {
      const tour = JSON.parse(fs.readFileSync(path.join(folder, file), 'utf8'));
      assert.deepEqual(whatIsWrongWith(tour), [], `${file} has mistakes in it`);
    }
  });

  it('say why, wherever they say a step cannot be done for you', () => {
    // A greyed-out button with no explanation is a worse answer than no button.
    const tour = JSON.parse(fs.readFileSync(path.join(here, '..', 'tours', 'stock-control.json'), 'utf8'));

    for (const step of tour.steps) {
      if (step.canDo === false) {
        assert.ok(step.whyNot, `${step.id} refuses to do the step and does not say why`);
      }
    }
  });
});
