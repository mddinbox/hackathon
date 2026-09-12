/**
 * The Compare surface — product research as a visual decision, not a paragraph.
 *
 * The assembled options are laid out as cards: a name, a price, a rating, the
 * pros and cons at a glance, and the single recommended pick highlighted. A
 * verdict leads. The runner-up intent (ready to buy vs still exploring) is one
 * tap away, and Refine narrows it — the same self-improving loop as the other
 * worlds. No links; every value is the answer itself.
 */
import { brandRow } from './chrome';
import { h } from './dom';
import type { ViewContext } from './state';
import type { CompareOption } from '../intent-to-world/situation-intelligence/scenarios';

function ratingStars(rating: number): HTMLElement {
  const filled = Math.round(rating);
  const dots = Array.from({ length: 5 }, (_, i) =>
    h('span', { class: `compare-star${i < filled ? ' compare-star--on' : ''}` }, [])
  );
  return h('span', { class: 'compare-rating' }, [
    h('span', { class: 'compare-stars', 'aria-label': `${rating} of 5` }, dots),
    h('span', { class: 'compare-rating-num' }, [rating.toFixed(1)])
  ]);
}

function optionCard(option: CompareOption): HTMLElement {
  return h('div', { class: `compare-option${option.best ? ' compare-option--best' : ''}`, 'data-node': 'compare-option' }, [
    h('div', { class: 'compare-option-head' }, [
      h('span', { class: 'compare-option-name' }, [option.name]),
      option.best ? h('span', { class: 'compare-option-badge' }, ['Best pick']) : null
    ]),
    h('div', { class: 'compare-option-meta' }, [
      option.price ? h('span', { class: 'compare-option-price' }, [option.price]) : null,
      ratingStars(option.rating)
    ]),
    option.pros.length > 0
      ? h(
          'ul',
          { class: 'compare-pros' },
          option.pros.map((p) => h('li', {}, [h('span', { class: 'compare-mark compare-mark--pro' }, ['+']), p]))
        )
      : null,
    option.cons.length > 0
      ? h(
          'ul',
          { class: 'compare-cons' },
          option.cons.map((c) => h('li', {}, [h('span', { class: 'compare-mark compare-mark--con' }, ['–']), c]))
        )
      : null
  ]);
}

export function renderCompare(ctx: ViewContext): HTMLElement {
  const result = ctx.state.compare;
  const plan = ctx.state.decisionPlan;
  const pending = ctx.state.decisionPending;

  const lead = h('section', { class: 'decision-lead', 'data-node': 'decision-lead' }, [
    plan
      ? h('p', { class: 'decision-direction', 'data-node': 'decision-direction' }, [
          h('span', { class: 'decision-direction-tag' }, ['Looks like']),
          plan.top.label
        ])
      : null,
    h('h1', { class: 'decision-headline', 'data-node': 'decision-headline' }, [
      result?.headline ?? (pending ? 'Comparing the options…' : 'Comparing the options')
    ])
  ]);

  const options = result?.options ?? [];
  const grid =
    options.length > 0
      ? h('div', { class: 'compare-grid', 'data-node': 'compare-grid' }, options.map(optionCard))
      : h('p', { class: 'decision-assembling', 'data-node': 'decision-pending' }, [
          pending ? 'Assembling the comparison…' : 'No options could be assembled.'
        ]);

  const verdict = result?.verdict
    ? h('p', { class: 'compare-verdict', 'data-node': 'compare-verdict' }, [
        h('span', { class: 'compare-verdict-tag' }, ['Verdict']),
        result.verdict
      ])
    : null;

  const alt =
    plan?.alternative && plan.alternative.id !== plan.top.id
      ? (() => {
          const button = h('button', { type: 'button', class: 'decision-alternative', 'data-node': 'decision-alternative' }, [
            h('span', { class: 'decision-alt-tag' }, ['Actually']),
            `${plan.alternative.label}?`
          ]);
          button.addEventListener('click', () => ctx.actions.rerootDecision(plan.alternative!.id));
          return button;
        })()
      : null;

  const refineInput = h('input', {
    type: 'text',
    class: 'decision-refine-input',
    'data-node': 'decision-refine-input',
    placeholder: 'Narrow it — e.g. “under $800”, “best for gaming”, “most reliable”'
  }) as HTMLInputElement;
  const refineForm = h('form', { class: 'decision-refine' }, [
    refineInput,
    h('button', { type: 'submit', class: 'decision-refine-submit', 'data-node': 'decision-refine-submit' }, ['Refine'])
  ]);
  refineForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = refineInput.value.trim();
    if (text) ctx.actions.refineDecision(text);
  });

  const back = h('button', { type: 'button', class: 'link-button', 'data-node': 'back-home' }, ['Start over']);
  back.addEventListener('click', () => ctx.actions.backHome());

  return h('div', { class: 'shell shell--compare', 'data-node': 'decision' }, [
    brandRow(ctx, 'home'),
    h('main', { class: 'compare-stage' }, [
      lead,
      grid,
      verdict,
      h('div', { class: 'decision-actions' }, [alt].filter(Boolean) as HTMLElement[]),
      refineForm,
      h('div', { class: 'decision-controls' }, [back])
    ])
  ]);
}
