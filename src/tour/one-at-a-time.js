/**
 * Watching a step without watching it six times at once.
 *
 * This is here rather than inside `tour/main.js` for the reason that keeps
 * coming up: a module that imports Electron cannot be tested, and the rule this
 * file is about is exactly the one worth a test. What was wrong was never
 * Electron's doing — it was arithmetic about time — so it had no business
 * living next to a `BrowserWindow`.
 *
 * ── What went wrong ──────────────────────────────────────────────────────────
 *
 * The first version watched a step with `setInterval(look, 600)` where `look`
 * is asynchronous and reads a control across a process boundary. That read
 * takes longer than 600ms more often than not, so several `look`s were in
 * flight together. Each one read the same finished condition; each one
 * announced it; each one queued an advance. From a real log:
 *
 *     step finished  start-a-new-order      (six times)
 *     stopped        finished: 6, of: 6
 *
 * Six of six, with the second step never begun. And on closing, a timer still
 * in flight reached into a destroyed window: `TypeError: Object has been
 * destroyed`.
 *
 * ── The three properties, which are not the same property ────────────────────
 *
 *  1. **Never two at once.** The next poll is scheduled *after* the previous
 *     one has returned, not on a fixed interval. An interval assumes the body
 *     is faster than the interval and nothing checks that assumption.
 *
 *  2. **At most one finish.** A generation counter, closed before the finish is
 *     announced. Not overlapping is not enough on its own: two *consecutive*
 *     polls of a step that is already finished would each announce it, because
 *     the condition stays true after it comes true.
 *
 *  3. **Stopping stops everything.** No timer survives, and anything returning
 *     from an await afterwards finds itself a generation behind and does
 *     nothing.
 *
 * The timer functions are arguments so a test can drive this with a clock it
 * controls. A test of concurrency that depends on real time is a test that
 * passes on the machine that wrote it (rule 53).
 */

export function oneAtATime({ every = 600, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let generation = 0;
  let timer = null;
  let stopped = false;

  function clearPending() {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  }

  /** Everything currently in flight is now out of date. */
  function moveOn() {
    clearPending();
    generation += 1;
    return generation;
  }

  return {
    get generation() {
      return generation;
    },

    get stopped() {
      return stopped;
    },

    /** Is this token still the current one — i.e. may its holder still act? */
    holds(token) {
      return !stopped && token === generation;
    },

    /**
     * Watch until `look` says it is done, then call `finished` — once.
     *
     * `look(polls)` is awaited and should return `{ done }`. `polls` counts from
     * zero, so a caller can do something every so many rounds without keeping a
     * counter of its own.
     *
     * Returns the generation this watch belongs to, which the caller can check
     * with `holds` after any await of its own.
     */
    watch(look, finished) {
      if (stopped) return generation;

      const mine = moveOn();

      const round = async (polls) => {
        if (stopped || mine !== generation) return;

        let said;
        try {
          said = await look(polls);
        } catch (error) {
          // A reading that threw is a reading that did not happen. Stopping the
          // whole tour because one poll failed would make a flaky bridge look
          // like a broken application, so it is treated as "not yet" — and the
          // caller is told, because a poll that never succeeds is worth seeing.
          said = { done: false, threw: error };
        }

        if (stopped || mine !== generation) return;

        if (!said?.done) {
          timer = setTimer(() => void round(polls + 1), every);
          return;
        }

        // The latch closes BEFORE anything is announced. Anything else still
        // holding `mine` is now a generation behind and will do nothing.
        moveOn();
        finished(said);
      };

      timer = setTimer(() => void round(0), every);
      return mine;
    },

    /**
     * Abandon what is being watched — a skip, or moving to another step.
     * Returns the new generation.
     */
    interrupt() {
      return moveOn();
    },

    /** For good. Nothing pending, and nothing may act again. */
    stop() {
      clearPending();
      generation += 1;
      stopped = true;
    },
  };
}
