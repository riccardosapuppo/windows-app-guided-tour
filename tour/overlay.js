/**
 * The overlay, in the renderer.
 *
 * It draws four rectangles and moves a card. That is the whole of it, and the
 * two parts worth reading are `cut()` — which places the panes around a hole —
 * and `place()`, which keeps the card off the control it is describing.
 */

const $ = (id) => document.getElementById(id);

const dims = { top: $('dimTop'), bottom: $('dimBottom'), left: $('dimLeft'), right: $('dimRight') };

let hole = null;

// ------------------------------------------------------------------ the hole

/**
 * Four panes meeting around a rectangle.
 *
 *   ┌──────── top ────────┐
 *   │ left │  hole  │ right │      the hole is what nothing covers
 *   └────── bottom ───────┘
 *
 * Left and right only span the height of the hole, so the four never overlap.
 * Overlapping them looks identical at 55% opacity and is twice as dark where
 * they meet, which reads as a border nobody drew.
 */
function cut(rect) {
  hole = rect;

  const width = window.innerWidth;
  const height = window.innerHeight;

  // A little air, so the ring does not sit on the control's own edge.
  const pad = 6;
  const x = Math.max(0, rect.x - pad);
  const y = Math.max(0, rect.y - pad);
  const w = Math.min(width - x, rect.width + pad * 2);
  const h = Math.min(height - y, rect.height + pad * 2);

  Object.assign(dims.top.style, { left: '0px', top: '0px', width: `${width}px`, height: `${y}px` });
  Object.assign(dims.bottom.style, {
    left: '0px',
    top: `${y + h}px`,
    width: `${width}px`,
    height: `${Math.max(0, height - y - h)}px`,
  });
  Object.assign(dims.left.style, { left: '0px', top: `${y}px`, width: `${x}px`, height: `${h}px` });
  Object.assign(dims.right.style, {
    left: `${x + w}px`,
    top: `${y}px`,
    width: `${Math.max(0, width - x - w)}px`,
    height: `${h}px`,
  });

  const ring = $('ring');
  ring.hidden = false;
  Object.assign(ring.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` });

  place();
}

/** Everything dark, when there is nothing to point at. */
function coverEverything() {
  hole = null;
  $('ring').hidden = true;

  Object.assign(dims.top.style, {
    left: '0px',
    top: '0px',
    width: `${window.innerWidth}px`,
    height: `${window.innerHeight}px`,
  });
  for (const side of ['bottom', 'left', 'right']) {
    Object.assign(dims[side].style, { width: '0px', height: '0px' });
  }
}

/**
 * The card, near the control and never on it.
 *
 * Below when there is room, above when there is not, and pushed inside the
 * screen either way. A card that covers the button it is describing is the
 * single most annoying thing an overlay tutorial does.
 */
function place() {
  const card = $('card');
  if (card.hidden) return;

  const box = card.getBoundingClientRect();
  const gap = 16;

  if (!hole) {
    card.style.left = `${Math.round((window.innerWidth - box.width) / 2)}px`;
    card.style.top = `${Math.round(window.innerHeight * 0.62)}px`;
    return;
  }

  const below = hole.y + hole.height + gap;
  const above = hole.y - box.height - gap;

  const top = below + box.height < window.innerHeight ? below : Math.max(gap, above);
  const left = Math.min(
    Math.max(gap, hole.x + hole.width / 2 - box.width / 2),
    window.innerWidth - box.width - gap
  );

  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
}

// --------------------------------------------------------------- the clicks

/**
 * The window ignores the mouse so the application underneath can be used, and
 * has to stop ignoring it while the pointer is over the card.
 *
 * `mousemove` still arrives because the window was told to forward it. Without
 * the forwarding it would hear nothing at all and the buttons would never work
 * — which looks like a broken tour and is one line of configuration.
 */
let over = false;

document.addEventListener('mousemove', (event) => {
  const card = document.elementFromPoint(event.clientX, event.clientY)?.closest('.card');
  const now = Boolean(card) && !card.hidden;

  if (now === over) return;
  over = now;
  window.tour.overTheCard(now);
});

$('doIt').addEventListener('click', async () => {
  const button = $('doIt');
  button.disabled = true;
  const said = await window.tour.doIt();
  button.disabled = false;

  if (!said.ok) {
    $('watchingWhy').textContent = said.why ?? 'that did not work';
    $('watchingWhy').dataset.trouble = 'yes';
  }
});

$('skip').addEventListener('click', () => window.tour.skip());
$('stop').addEventListener('click', () => window.tour.stop());
$('close').addEventListener('click', () => window.tour.stop());
$('openLog').addEventListener('click', () => window.tour.openLog());

// ---------------------------------------------------------- what comes back

window.tour.on('tour', (about) => {
  $('title').textContent = about.title;
  $('say').textContent = about.about ?? '';
  coverEverything();
  place();
});

window.tour.on('step', (step) => {
  $('count').textContent = `${step.number} of ${step.of}`;
  $('say').textContent = step.say;
  $('lost').hidden = true;

  $('watchingWhy').textContent = '';
  delete $('watchingWhy').dataset.trouble;

  $('doIt').hidden = !step.canDo;
  $('whyNot').hidden = step.canDo || !step.whyNot;
  $('whyNot').textContent = step.whyNot ?? '';

  place();
});

window.tour.on('hole', (rect) => cut(rect));

window.tour.on('lost', (about) => {
  // Named, not hidden. "The tour cannot see the application" is something the
  // person can act on — bring the window forward — where a tour that simply
  // stops moving is one they will sit and wait for.
  coverEverything();
  $('lost').hidden = false;
  $('lost').textContent = `${about.why}. Looking in a window called "${about.window}".`;
  place();
});

window.tour.on('watching', (said) => {
  $('watchingWhy').textContent = said.done ? said.why : `waiting: ${said.why}`;
  delete $('watchingWhy').dataset.trouble;
});

window.tour.on('finished', (about) => {
  coverEverything();
  $('card').hidden = true;
  $('done').hidden = false;

  const done = about.steps.filter((one) => one.how === 'done').length;
  const skipped = about.steps.length - done;

  $('doneSay').textContent =
    skipped === 0
      ? `All ${done} steps, done and seen to be done.`
      : `${done} done, ${skipped} skipped. The log says which.`;

  place();
});

window.addEventListener('resize', () => {
  if (hole) cut(hole);
  else coverEverything();
});

coverEverything();
