/**
 * What a step is, and how a step is known to be finished.
 *
 * A guided tour has one hard problem and it is not drawing the box. It is
 * knowing when to move on.
 *
 * The easy answer — "we sent a click, so it happened" — is what makes most
 * overlay tutorials infuriating. The click landed on a disabled button, or the
 * window had not finished opening, or the person had already done the step
 * themselves and the tour insists they do it again. So nothing here is finished
 * because the tour did something. A step is finished when the APPLICATION says
 * so, read back out of the accessibility tree.
 *
 * Four ways it can say so, and each exists because the others cannot cover it:
 *
 *   `value`    the text in a control is what it should be. For anything typed.
 *   `enabled`  a control that was greyed out no longer is. This is how a
 *              well-built application announces that a precondition is met, and
 *              it is often the only signal there is.
 *   `says`     a status line contains a phrase. The one an application writes
 *              for a person to read, which is exactly what a tour wants.
 *   `gone`     a control is no longer there. Dialogs.
 *
 * There is deliberately no "the tour clicked it" condition. If a step cannot be
 * observed, that is worth knowing while the tour is being written rather than
 * in front of somebody being taught.
 */

/** The conditions a step may end on. */
export const CONDITIONS = ['value', 'enabled', 'says', 'gone'];

/**
 * Reads a tour document and says what is wrong with it.
 *
 * Up front, before anybody sees a single step. A tour with a mistyped
 * automation id at step seven fails in front of the person it was meant to
 * help, five minutes in, and the mistake is invisible until then.
 *
 * @returns {string[]} what is wrong, empty when nothing is
 */
export function whatIsWrongWith(tour) {
  const wrong = [];

  if (!tour || typeof tour !== 'object') return ['a tour has to be an object'];
  if (!tour.window) wrong.push('a tour has to say which window it is about');
  if (!Array.isArray(tour.steps) || tour.steps.length === 0) wrong.push('a tour with no steps teaches nothing');

  const seen = new Set();

  for (const [at, step] of (tour.steps ?? []).entries()) {
    const where = `step ${at + 1}${step?.id ? ` (${step.id})` : ''}`;

    if (!step?.id) wrong.push(`${where}: every step needs an id, so a log can name it`);
    else if (seen.has(step.id)) wrong.push(`${where}: two steps share the id "${step.id}"`);
    else seen.add(step.id);

    if (!step?.say) wrong.push(`${where}: a step has to say something`);

    if (!step?.point?.id && !step?.point?.name) {
      wrong.push(`${where}: a step has to point at a control, by id or by name`);
    }

    // A step with no `done` is a step that can never be left. Better to be
    // told now than to watch somebody click a button that does nothing.
    if (!step?.done) {
      wrong.push(`${where}: a step has to say how it will know it is finished`);
      continue;
    }

    if (!CONDITIONS.includes(step.done.when)) {
      wrong.push(
        `${where}: "${step.done.when}" is not something this can wait for. It knows: ${CONDITIONS.join(', ')}`
      );
      continue;
    }

    if (step.done.when === 'value' && step.done.is === undefined && !step.done.contains && !step.done.matches) {
      wrong.push(`${where}: waiting on a value needs "is", "contains" or "matches"`);
    }

    if (step.done.when === 'says' && !step.done.contains) {
      wrong.push(`${where}: waiting on what the application says needs "contains"`);
    }

    if ((step.done.when === 'enabled' || step.done.when === 'gone') && !step.done.of?.id && !step.done.of?.name) {
      wrong.push(`${where}: waiting on "${step.done.when}" needs to say which control`);
    }
  }

  return wrong;
}

/**
 * Which control a condition is watching.
 *
 * Usually the one being pointed at, and sometimes not: "type a customer, then
 * the Save button lights up" points at the text box and waits on the button.
 */
export function watching(step) {
  return step.done.of ?? step.point;
}

/**
 * Is this step finished, given what was just read from the application?
 *
 * `reading` is what the bridge returned: `{ ok, value, element }`, or
 * `{ ok: false }` when the control could not be found.
 *
 * @returns {{ done: boolean, why: string }}
 */
export function isFinished(step, reading) {
  const { done } = step;

  if (done.when === 'gone') {
    return reading?.ok
      ? { done: false, why: 'it is still there' }
      : { done: true, why: 'it has gone' };
  }

  if (!reading?.ok) {
    // Not found is not finished — except for `gone`, above. Treating a missing
    // control as a finished step is how a tour races ahead when a window is
    // slow to draw.
    return { done: false, why: reading?.why ?? 'the control could not be found' };
  }

  if (done.when === 'enabled') {
    return reading.element?.enabled
      ? { done: true, why: 'it can be used now' }
      : { done: false, why: 'it is still greyed out' };
  }

  const said = String(reading.value ?? '');

  if (done.when === 'says') {
    return said.toLowerCase().includes(String(done.contains).toLowerCase())
      ? { done: true, why: `it says "${said}"` }
      : { done: false, why: `it says "${said}"` };
  }

  // value
  if (done.is !== undefined) {
    return said === String(done.is)
      ? { done: true, why: `it is "${said}"` }
      : { done: false, why: `it is "${said}", not "${done.is}"` };
  }

  if (done.contains) {
    return said.toLowerCase().includes(String(done.contains).toLowerCase())
      ? { done: true, why: `it contains "${done.contains}"` }
      : { done: false, why: `"${said}" does not contain "${done.contains}"` };
  }

  // A pattern, for the cases the other two cannot reach: a reference number
  // that is generated, a date, anything with a shape rather than a value.
  let pattern;
  try {
    pattern = new RegExp(done.matches);
  } catch (error) {
    // A bad pattern in a tour must not look like a step that is never finished.
    return { done: false, why: `that step has a pattern that is not one: ${error.message}` };
  }

  return pattern.test(said)
    ? { done: true, why: `"${said}" matches` }
    : { done: false, why: `"${said}" does not match ${done.matches}` };
}

/**
 * Which reading a step needs, so the runner asks for one thing and not three.
 *
 * `enabled` and `gone` want the element itself; the other two want its value.
 * Asking for both on every poll doubles the traffic across a process boundary
 * several times a second.
 */
export function whatToRead(step) {
  return step.done.when === 'enabled' || step.done.when === 'gone' ? 'find' : 'value';
}
