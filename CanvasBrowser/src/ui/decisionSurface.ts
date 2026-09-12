/**
 * The Decision Surface — the pickup pattern applied to a non-map job.
 *
 * It leads with the decision, exactly like Journey World leads with a leave-by
 * time: the inferred direction and the one-line decision appear instantly from
 * the plan, the resolved forces fill in as they assemble, the runner-up
 * direction sits one tap away so a wrong guess is cheap, and a single action
 * carries it out. No list of links — every force is the answer itself.
 *
 * The feedback prompt at the foot is the self-improving loop: a correction here
 * re-roots the decision and teaches the engine, so the next visit is smarter.
 */
import { brandRow } from './chrome';
import { h } from './dom';
import type { ViewContext } from './state';

function forceCard(force: { label: string; value: string; note?: string }): HTMLElement {
  return h('div', { class: 'decision-force', 'data-node': 'decision-force' }, [
    h('p', { class: 'decision-force-label' }, [force.label]),
    h('p', { class: 'decision-force-value' }, [force.value]),
    force.note ? h('p', { class: 'decision-force-note' }, [force.note]) : null
  ]);
}

export function renderDecision(ctx: ViewContext): HTMLElement {
  const plan = ctx.state.decisionPlan;
  const result = ctx.state.decision;
  const pending = ctx.state.decisionPending;

  // The lead is instant: the inferred direction and the decision come from the
  // plan, before the model has assembled a thing.
  const direction = result?.direction ?? plan?.top.label ?? 'Working it out';
  const headline = result?.headline ?? plan?.decision ?? '';
  const evidence = plan?.top.evidence ?? [];

  const lead = h('section', { class: 'decision-lead', 'data-node': 'decision-lead' }, [
    plan?.branches
      ? h('p', { class: 'decision-direction', 'data-node': 'decision-direction' }, [
          h('span', { class: 'decision-direction-tag' }, ['Looks like']),
          direction
        ])
      : null,
    h('h1', { class: 'decision-headline', 'data-node': 'decision-headline' }, [headline]),
    plan?.branches && evidence.length > 0
      ? h('p', { class: 'decision-evidence' }, [`Read from your words: ${evidence.join('; ')}.`])
      : null
  ]);

  const forces = result?.forces ?? [];
  const body =
    forces.length > 0
      ? h('div', { class: 'decision-forces', 'data-node': 'decision-forces' }, forces.map(forceCard))
      : h('p', { class: 'decision-assembling', 'data-node': 'decision-pending' }, [
          pending ? 'Assembling the decision…' : 'No details could be assembled.'
        ]);

  // The runner-up direction, one tap away. Tapping it re-roots and teaches.
  const alternative =
    plan?.alternative && plan.alternative.id !== plan.top.id
      ? (() => {
          const button = h(
            'button',
            { type: 'button', class: 'decision-alternative', 'data-node': 'decision-alternative' },
            [h('span', { class: 'decision-alt-tag' }, ['Actually']), `${plan.alternative.label}?`]
          );
          button.addEventListener('click', () => ctx.actions.rerootDecision(plan.alternative!.id));
          return button;
        })()
      : null;

  // The single carry-it-out action.
  const action = result?.action
    ? (() => {
        const button = h(
          'button',
          { type: 'button', class: 'decision-action', 'data-node': 'decision-action' },
          [result.action]
        );
        button.addEventListener('click', () => ctx.actions.actOnDecision());
        return button;
      })()
    : null;

  // The self-improving prompt: correct or refine, and the engine learns.
  const refineInput = h('input', {
    type: 'text',
    class: 'decision-refine-input',
    'data-node': 'decision-refine-input',
    placeholder: 'Not quite? Correct or add detail — e.g. “I’m investing” or “with two kids”',
    'aria-label': 'Refine or correct the decision'
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

  return h('div', { class: 'shell shell--decision', 'data-node': 'decision' }, [
    brandRow(ctx, 'home'),
    h('main', { class: 'decision-stage' }, [
      lead,
      body,
      h('div', { class: 'decision-actions' }, [action, alternative].filter(Boolean) as HTMLElement[]),
      refineForm,
      h('div', { class: 'decision-controls' }, [back])
    ])
  ]);
}
