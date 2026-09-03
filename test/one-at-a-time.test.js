/**
 * The tests the tour did not have, written against the failure it actually had.
 *
 * The first one — "a reading slower than the interval is still only one
 * reading" — is the whole reason this file exists. Run it against the old
 * `setInterval` version and it fails by announcing the step six times, which is
 * exactly what the log from the person using it showed.
 *
 * A clock is passed in rather than waited on. A concurrency test that sleeps is
 * a test that passes on the machine that wrote it.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { oneAtATime } from '../src/tour/one-at-a-time.js';

/**
 * A clock that only moves when told.
 *
 * `tick()` runs everything due now, including anything those callbacks
 * scheduled for the same moment — which is what makes a self-rescheduling loop
 * observable at all.
 */
function clock() {
  let now = 0;
  let next = 1;
  const pending = new Map();

  return {
    setTimer(fn, ms) {
      const id = next++;
      pending.set(id, { at: now + (ms ?? 0), fn });
      return id;
    },
    clearTimer(id) {
      pending.delete(id);
    },
    get waiting() {
      return pending.size;
    },
    /** Move to the earliest thing due and run it. Returns false if nothing is. */
    step() {
      if (pending.size === 0) return false;

      const [id, job] = [...pending.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      pending.delete(id);
      now = Math.max(now, job.at);
      job.fn();
      return true;
    },
    /** Run up to `rounds` due jobs, letting promises settle between each. */
    async run(rounds = 20) {
      for (let i = 0; i < rounds; i += 1) {
        if (!this.step()) return;
        // Let every awaited microtask settle before the next timer fires.
        for (let j = 0; j < 8; j += 1) await Promise.resolve();
      }
    },
  };
}

describe('watching a step one poll at a time', () => {
  it('a reading slower than the interval is still only one reading', async () => {
    const time = clock();
    const watcher = oneAtATime({ every: 600, setTimer: time.setTimer, clearTimer: time.clearTimer });

    let inFlight = 0;
    let most = 0;
    let release = null;

    const look = async () => {
      inFlight += 1;
      most = Math.max(most, inFlight);
      // A reading that does not come back until it is let go — which is what a
      // process boundary looks like when the machine is busy.
      await new Promise((done) => {
        release = done;
      });
      inFlight -= 1;
      return { done: false };
    };

    watcher.watch(look, () => {});

    time.step(); // the first poll starts and blocks inside `look`
    await Promise.resolve();

    // The interval version would have queued a second poll here regardless.
    assert.equal(time.waiting, 0, 'nothing may be scheduled while a poll is in flight');

    release();
    for (let i = 0; i < 8; i += 1) await Promise.resolve();

    assert.equal(most, 1, 'two polls were in flight at once');
    assert.equal(time.waiting, 1, 'the next poll is scheduled only after the last one returned');
  });

  it('a step that stays finished is announced once, not once per poll', async () => {
    const time = clock();
    const watcher = oneAtATime({ every: 10, setTimer: time.setTimer, clearTimer: time.clearTimer });

    let announced = 0;
    // Finished from the very first look, and it stays finished — which is what
    // a real condition does. "The status line says A new order" does not stop
    // being true on the next poll.
    watcher.watch(
      async () => ({ done: true, why: 'it says "A new order"' }),
      () => {
        announced += 1;
      }
    );

    await time.run(10);

    assert.equal(announced, 1);
    assert.equal(time.waiting, 0, 'nothing is left pending after a step finishes');
  });

  it('a poll already in flight cannot finish a step that was skipped', async () => {
    const time = clock();
    const watcher = oneAtATime({ every: 10, setTimer: time.setTimer, clearTimer: time.clearTimer });

    let announced = 0;
    let release = null;

    watcher.watch(
      async () => {
        await new Promise((done) => {
          release = done;
        });
        return { done: true };
      },
      () => {
        announced += 1;
      }
    );

    time.step();
    await Promise.resolve();

    // The person pressed Skip while the reading was still out.
    watcher.interrupt();

    release();
    for (let i = 0; i < 8; i += 1) await Promise.resolve();

    assert.equal(announced, 0, 'a reading from before the skip finished the wrong step');
  });

  it('stopping leaves nothing pending and nothing able to act', async () => {
    const time = clock();
    const watcher = oneAtATime({ every: 10, setTimer: time.setTimer, clearTimer: time.clearTimer });

    let announced = 0;
    const token = watcher.watch(
      async () => ({ done: true }),
      () => {
        announced += 1;
      }
    );

    watcher.stop();
    await time.run(10);

    assert.equal(time.waiting, 0, 'a timer survived the stop');
    assert.equal(announced, 0);
    assert.equal(watcher.holds(token), false, 'a token from before the stop still holds');
    assert.equal(watcher.stopped, true);
  });

  it('a reading that throws is not a finished step', async () => {
    const time = clock();
    const watcher = oneAtATime({ every: 10, setTimer: time.setTimer, clearTimer: time.clearTimer });

    let looks = 0;
    let announced = 0;

    watcher.watch(
      async () => {
        looks += 1;
        if (looks < 3) throw new Error('the helper did not answer');
        return { done: true };
      },
      () => {
        announced += 1;
      }
    );

    await time.run(20);

    assert.equal(looks, 3, 'it stopped looking after a failed reading');
    assert.equal(announced, 1);
  });

  it('a token stops holding as soon as the watch moves on', () => {
    const watcher = oneAtATime({ every: 10, setTimer: () => 0, clearTimer: () => {} });

    const first = watcher.watch(async () => ({ done: false }), () => {});
    assert.equal(watcher.holds(first), true);

    const second = watcher.watch(async () => ({ done: false }), () => {});
    assert.equal(watcher.holds(first), false, 'the old generation still holds');
    assert.equal(watcher.holds(second), true);
  });
});
