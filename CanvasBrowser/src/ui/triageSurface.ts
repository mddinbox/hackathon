/**
 * The Triage surface — a possible emergency handled visually and safely, not as
 * a paragraph of text.
 *
 * It leads with a colour-coded severity banner and a prominent "get emergency
 * help" action, then the things to do right now, the red-flag signs that mean
 * seek care immediately, and — de-emphasised — the calmer possible causes. It
 * never diagnoses and never buries the escalation. No links.
 */
import { brandRow } from './chrome';
import { h } from './dom';
import type { ViewContext } from './state';
import type { Severity } from '../intent-to-world/situation-intelligence/scenarios';

const SEVERITY_LABEL: Record<Severity, string> = {
  emergency: 'Possible emergency',
  urgent: 'Get this checked soon',
  routine: 'Likely not urgent'
};

function list(title: string, items: string[], node: string, markClass: string): HTMLElement | null {
  if (items.length === 0) return null;
  return h('section', { class: 'triage-block', 'data-node': node }, [
    h('h2', { class: 'triage-block-title' }, [title]),
    h(
      'ul',
      { class: 'triage-list' },
      items.map((item) => h('li', {}, [h('span', { class: `triage-mark ${markClass}` }, []), item]))
    )
  ]);
}

export function renderTriage(ctx: ViewContext): HTMLElement {
  const result = ctx.state.triage;
  const pending = ctx.state.decisionPending;
  const severity: Severity = result?.severity ?? 'emergency';

  const banner = h('section', { class: `triage-banner triage-banner--${severity}`, 'data-node': 'triage-banner' }, [
    h('span', { class: 'triage-severity', 'data-node': 'triage-severity' }, [SEVERITY_LABEL[severity]]),
    h('p', { class: 'triage-headline', 'data-node': 'triage-headline' }, [
      result?.headline ?? (pending ? 'Assessing what to do…' : 'When in doubt about a serious symptom, seek care.')
    ])
  ]);

  const callButton = h('button', { type: 'button', class: 'triage-emergency', 'data-node': 'triage-emergency' }, [
    'Get emergency help now'
  ]);
  callButton.addEventListener('click', () =>
    window.open('https://www.bing.com/search?q=emergency+number+near+me', '_blank', 'noopener')
  );

  const body =
    result || !pending
      ? h('div', { class: 'triage-body' }, [
          list('Do this now', result?.actNow ?? [], 'triage-actnow', 'triage-mark--now'),
          list('Seek emergency care if…', result?.emergency ?? [], 'triage-emergency-list', 'triage-mark--flag'),
          list('Possible, calmer explanations', result?.causes ?? [], 'triage-causes', 'triage-mark--cause')
        ])
      : h('p', { class: 'decision-assembling', 'data-node': 'decision-pending' }, ['Assessing…']);

  const disclaimer = h('p', { class: 'triage-disclaimer' }, [
    'This is safety guidance, not a diagnosis. If you are worried, contact a clinician or emergency services.'
  ]);

  const refineInput = h('input', {
    type: 'text',
    class: 'decision-refine-input',
    'data-node': 'decision-refine-input',
    placeholder: 'Add detail — e.g. “also dizzy”, “started an hour ago”, “I have asthma”'
  }) as HTMLInputElement;
  const refineForm = h('form', { class: 'decision-refine' }, [
    refineInput,
    h('button', { type: 'submit', class: 'decision-refine-submit', 'data-node': 'decision-refine-submit' }, ['Update'])
  ]);
  refineForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const text = refineInput.value.trim();
    if (text) ctx.actions.refineDecision(text);
  });

  const back = h('button', { type: 'button', class: 'link-button', 'data-node': 'back-home' }, ['Start over']);
  back.addEventListener('click', () => ctx.actions.backHome());

  return h('div', { class: 'shell shell--triage', 'data-node': 'decision' }, [
    brandRow(ctx, 'home'),
    h('main', { class: 'triage-stage' }, [
      banner,
      h('div', { class: 'triage-action-row' }, [callButton]),
      body,
      disclaimer,
      refineForm,
      h('div', { class: 'decision-controls' }, [back])
    ])
  ]);
}
