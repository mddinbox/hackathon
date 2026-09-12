/**
 * The clarification surface.
 *
 * One question, two or three choices, nothing else. There is no progress
 * wizard, no step counter, and no form: the question budget is visible only
 * as the fact that the surface appears at most twice before a world exists.
 *
 * It is deliberately **world-shaped**, not a dialog on a blank page. A Travel
 * question is asked inside a forming Time Terrain — a faint time axis and the
 * arrival lanes already drawn behind it — so the answer lands in a place the
 * user has already begun to read. Research runs beside the question, never in
 * front of it, which is why nobody is ever parked on a page of prose first.
 */
import { JOB_QUESTION } from '../pickupIntent';
import type { ClarifyQuestion } from '../inference';
import { brandRow } from './chrome';
import { h } from './dom';
import type { ViewContext } from './state';

const FORMING_LANES = [
  { label: 'Taxi & gate', start: 6, span: 12 },
  { label: 'Deplane', start: 16, span: 14 },
  { label: 'Passport & customs', start: 28, span: 26 },
  { label: 'Bags', start: 48, span: 22 },
  { label: 'Curb', start: 68, span: 18 }
];

/**
 * The Time Terrain, before it knows anything. Time still runs left to right
 * and the arrival still has stages: only the facts are missing.
 */
function formingTerrain(): HTMLElement {
  const ticks = [0, 20, 40, 60, 80, 100].map((percent) => {
    const tick = h('span', { class: 'forming-tick' }, []);
    tick.style.setProperty('--start', `${percent}%`);
    return tick;
  });

  const lanes = FORMING_LANES.map((lane) => {
    const band = h('span', { class: 'forming-band' }, []);
    band.style.setProperty('--start', `${lane.start}%`);
    band.style.setProperty('--span', `${lane.span}%`);
    return h('li', { class: 'forming-lane' }, [
      h('span', { class: 'forming-lane-label' }, [lane.label]),
      h('span', { class: 'forming-track' }, [band])
    ]);
  });

  return h('div', { class: 'forming-world', 'data-node': 'forming-world', 'aria-hidden': 'true' }, [
    h('div', { class: 'forming-axis' }, ticks),
    h('ul', { class: 'forming-lanes' }, lanes),
    h('span', { class: 'forming-now' }, [])
  ]);
}

/**
 * The one line under a question that justifies it existing.
 *
 * The product may ask at most two questions, and every one of them has had to
 * argue that its answer changes the template, the route, the decision envelope
 * or the handoff. This is where that argument is shown to the person paying
 * for it with their attention.
 */
function questionReason(question: ClarifyQuestion): HTMLElement | null {
  if (!question.reason) return null;
  return h('p', { class: 'clarify-reason', 'data-node': 'clarify-reason' }, [question.reason]);
}

function choiceButtons(ctx: ViewContext, question: ClarifyQuestion, prefix: string): HTMLElement {
  const choices = question.options.map((option) => {
    const button = h(
      'button',
      { type: 'button', class: 'choice-card', 'data-node': `${prefix}${option.id}` },
      [
        h('span', { class: 'choice-card-label' }, [option.label]),
        option.detail ? h('span', { class: 'choice-card-detail' }, [option.detail]) : null
      ]
    );
    if (prefix === 'hypothesis-') {
      button.addEventListener('click', () => ctx.actions.chooseJob(option.id as 'track' | 'connect' | 'pickup'));
    } else {
      button.addEventListener('click', () => ctx.actions.answerClarification(question.id, option.id));
    }
    return button;
  });
  return h('div', { class: 'clarify-choices', 'data-node': 'clarify-choices' }, choices);
}

function startOver(ctx: ViewContext): HTMLElement {
  const back = h('button', { type: 'button', class: 'link-button', 'data-node': 'back-home' }, ['Start over']);
  back.addEventListener('click', () => ctx.actions.backHome());
  return back;
}

function researchLine(ctx: ViewContext): HTMLElement {
  const pending = ctx.state.researchPending;
  return h(
    'p',
    { class: 'clarify-note', 'data-node': 'travel-research-status', role: 'status' },
    [
      pending
        ? 'Live research is already running beside this question. Nothing waits on prose.'
        : ctx.state.reading?.truth === 'observed'
          ? 'An arrival reading has landed. Whichever world you choose opens with it.'
          : 'Research came back without an actual arrival time. Whichever world you choose will say so.'
    ]
  );
}

/** Travel asks its one job question inside its own forming world. */
function travelClarify(ctx: ViewContext): HTMLElement {
  const question = ctx.state.travelQuestion ?? JOB_QUESTION;
  return h('div', { class: 'shell shell--clarify shell--travel-clarify', 'data-node': 'clarify-shell' }, [
    brandRow(ctx, 'world'),
    h(
      'main',
      {
        class: 'clarify-stage clarify-stage--travel',
        'data-node': 'clarify',
        role: 'region',
        'aria-label': 'One question'
      },
      [
        formingTerrain(),
        h('div', { class: 'clarify-copy' }, [
          h('p', { class: 'clarify-read', 'data-node': 'clarify-read' }, [
            ctx.state.situation?.flightLabel ?? 'Inbound flight'
          ]),
          h('h1', { class: 'clarify-question', 'data-node': 'clarify-question' }, [question.question]),
          questionReason(question),
          choiceButtons(ctx, question, 'hypothesis-'),
          researchLine(ctx),
          startOver(ctx)
        ])
      ]
    )
  ]);
}

/**
 * Travel, after the user chose to track the arrival but before the answer
 * exists. The world stays on screen; only the sentence changes.
 */
function trackingWait(ctx: ViewContext): HTMLElement {
  return h('div', { class: 'shell shell--clarify shell--travel-clarify', 'data-node': 'clarify-shell' }, [
    brandRow(ctx, 'world'),
    h(
      'main',
      {
        class: 'clarify-stage clarify-stage--travel',
        'data-node': 'clarify',
        role: 'region',
        'aria-label': 'Tracking the arrival'
      },
      [
        formingTerrain(),
        h('div', { class: 'clarify-copy' }, [
          h('p', { class: 'clarify-read', 'data-node': 'clarify-read' }, [
            ctx.state.situation?.flightLabel ?? 'Inbound flight'
          ]),
          h('h1', { class: 'clarify-question', 'data-node': 'tracking-wait' }, ['Tracking the arrival.']),
          researchLine(ctx),
          startOver(ctx)
        ])
      ]
    )
  ]);
}

export function renderClarify(ctx: ViewContext): HTMLElement {
  if (ctx.state.travelQuestion) return travelClarify(ctx);
  if (ctx.state.chosenJob === 'track') return trackingWait(ctx);

  const question = ctx.state.news.question;
  if (!question) return h('div', { class: 'shell' }, []);

  return h('div', { class: 'shell shell--clarify', 'data-node': 'clarify-shell' }, [
    brandRow(ctx, 'home'),
    h(
      'main',
      { class: 'clarify-stage', 'data-node': 'clarify', role: 'region', 'aria-label': 'One question' },
      [
        h('p', { class: 'clarify-read', 'data-node': 'clarify-read' }, [
          ctx.state.news.situation?.label ?? 'Reading what could reach your day.'
        ]),
        h('h1', { class: 'clarify-question', 'data-node': 'clarify-question' }, [question.question]),
        questionReason(question),
        choiceButtons(ctx, question, 'clarify-'),
        h('p', { class: 'clarify-note' }, ['Nothing else is asked. You reshape the world once it exists.']),
        startOver(ctx)
      ]
    )
  ]);
}
