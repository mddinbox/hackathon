/**
 * The single secondary control: appearance, accessibility, and an optional
 * developer mode. None of this is chrome in the consumer flow, and the demo
 * never opens it.
 */
import type { Appearance } from '../appearance';
import { DEMO_EXAMPLES } from './demoExamples';
import { h } from './dom';
import type { ViewContext } from './state';

interface ChoiceSpec<K extends keyof Appearance> {
  key: K;
  legend: string;
  options: Array<{ value: Appearance[K]; label: string }>;
}

function choiceGroup<K extends keyof Appearance>(ctx: ViewContext, spec: ChoiceSpec<K>): HTMLElement {
  const buttons = spec.options.map((option) => {
    const active = ctx.state.appearance[spec.key] === option.value;
    const button = h(
      'button',
      {
        type: 'button',
        class: 'choice',
        'data-node': `appearance-${String(spec.key)}-${String(option.value)}`,
        'aria-pressed': active ? 'true' : 'false'
      },
      [option.label]
    );
    button.addEventListener('click', () => ctx.actions.setAppearance({ [spec.key]: option.value } as Partial<Appearance>));
    return button;
  });
  return h('fieldset', { class: 'choice-group' }, [h('legend', {}, [spec.legend]), h('div', { class: 'choice-row' }, buttons)]);
}

/**
 * The one persistent behaviour preference in More.
 *
 * It is deliberately not grouped with the appearance controls: this one
 * changes what the product *does*, not how it looks. It stores consent and
 * nothing else, and the browser permission still decides every fix.
 */
function locationRow(ctx: ViewContext): HTMLElement {
  const toggle = h('input', {
    type: 'checkbox',
    id: 'always-location',
    'data-node': 'always-location-toggle',
    checked: ctx.state.alwaysUseLocation
  }) as HTMLInputElement;
  toggle.addEventListener('change', () => void ctx.actions.setAlwaysUseLocation(toggle.checked));

  const status = ctx.state.alwaysUseLocation ? statusLine(ctx.state.autoLocationStatus) : null;

  return h('fieldset', { class: 'choice-group', 'data-node': 'always-location-group' }, [
    h('legend', {}, ['Location']),
    h('label', { class: 'dev-row', for: 'always-location' }, [
      toggle,
      h('span', {}, ['Always use my location for relevant worlds'])
    ]),
    h('p', { class: 'muted' }, [
      'Requests a fresh fix when Travel or Living News needs it. Coordinates are coarsened on this device, never stored, and never sent to the model.'
    ]),
    ...(status ? [h('p', { class: 'muted', 'data-node': 'always-location-status', role: 'status' }, [status])] : [])
  ]);
}

/** A permission story, never a place. */
function statusLine(status: ViewContext['state']['autoLocationStatus']): string | null {
  switch (status) {
    case 'requesting':
      return 'Enabled · asking this browser for a fresh fix';
    case 'granted':
      return 'Enabled · a coarse area is in use for this session';
    case 'denied':
      return 'Enabled · browser permission denied';
    case 'unsupported':
      return 'Enabled · this browser cannot share location';
    case 'outside-region':
      return 'Enabled · current location is outside this prototype’s supported region';
    case 'timeout':
      return 'Enabled · the browser did not answer in time';
    default:
      return null;
  }
}

export function renderMoreMenu(ctx: ViewContext): HTMLDialogElement {
  const close = h('button', { type: 'button', class: 'ghost-button', 'data-node': 'more-close' }, ['Close']);

  const devToggle = h('input', {
    type: 'checkbox',
    id: 'dev-mode',
    'data-node': 'dev-mode-toggle',
    checked: ctx.state.devMode
  }) as HTMLInputElement;
  devToggle.addEventListener('change', () => ctx.actions.setDevMode(devToggle.checked));

  const menu = h('dialog', { class: 'popover', 'data-node': 'more-menu', 'aria-label': 'More' }, [
    h('div', { class: 'sheet-head' }, [h('h2', { class: 'sheet-title' }, ['More']), close]),
    choiceGroup(ctx, {
      key: 'contrast',
      legend: 'Contrast',
      options: [
        { value: 'standard', label: 'Standard' },
        { value: 'high', label: 'High' }
      ]
    }),
    choiceGroup(ctx, {
      key: 'motion',
      legend: 'Motion',
      options: [
        { value: 'full', label: 'Full' },
        { value: 'reduced', label: 'Reduced' }
      ]
    }),
    choiceGroup(ctx, {
      key: 'textSize',
      legend: 'Text size',
      options: [
        { value: 'standard', label: 'Standard' },
        { value: 'large', label: 'Large' }
      ]
    }),
    locationRow(ctx),
    h('label', { class: 'dev-row', for: 'dev-mode' }, [devToggle, h('span', {}, ['Developer mode'])]),
    h('p', { class: 'muted' }, ['Developer mode adds a plan readout for debugging. It is off by default and never used in the demo.'])
  ]) as HTMLDialogElement;

  close.addEventListener('click', () => ctx.actions.closeMore());
  menu.addEventListener('close', () => ctx.actions.closeMore());
  menu.addEventListener('cancel', () => ctx.actions.closeMore());
  return menu;
}

/** Compact developer readout. Only rendered when developer mode is on. */
export function renderDevPanel(ctx: ViewContext): HTMLElement {
  const news = ctx.state.news;
  const graph = ctx.state.situationGraph;
  const experience = ctx.state.experiencePlan;
  const payload = {
    view: ctx.state.view,
    questionsAsked: ctx.state.inference.questionsAsked,
    pendingQuestion: news.question?.id ?? null,
    chosenJob: ctx.state.chosenJob,
    reading: ctx.state.reading,
    assumptions: ctx.state.assumptions,
    origin: ctx.state.origin?.id ?? null,
    locationState: ctx.state.locationState,
    alwaysUseLocation: ctx.state.alwaysUseLocation,
    autoLocationStatus: ctx.state.autoLocationStatus,
    plan: ctx.state.plan,
    /*
     * The two engine artifacts, in full. This is the only surface that shows
     * them: the consumer world stays a world, and anyone who wants to argue
     * with the architecture can read it here instead of guessing.
     */
    situationGraph: graph,
    experiencePlan: experience
      ? {
          graphId: experience.graphId,
          family: experience.family,
          templateLabel: experience.templateLabel,
          blueprintSource: experience.blueprintSource,
          decisions: experience.decisions,
          visualForces: experience.visualForces,
          questionContract: experience.questionContract
        }
      : null,
    news: {
      scope: news.scope,
      horizon: news.horizon,
      place: news.place.label,
      placeTruth: news.placeTruth,
      layers: news.layers,
      radiusMiles: news.radiusMiles,
      focus: news.focus,
      signals: news.world?.signals.map((signal) => signal.id) ?? [],
      consequences: news.world?.consequences.map((item) => item.text) ?? []
    }
  };
  const examples = h('div', { class: 'dev-examples', 'data-node': 'dev-examples' }, [
    h('p', { class: 'dev-examples-title' }, ['Scenario examples — click to run']),
    h(
      'div',
      { class: 'dev-example-grid' },
      DEMO_EXAMPLES.map((example) => {
        const button = h(
          'button',
          { type: 'button', class: 'dev-example', 'data-node': `dev-example-${example.scenarioId}` },
          [
            h('span', { class: 'dev-example-label' }, [example.label]),
            h('span', { class: 'dev-example-prompt' }, [example.prompt])
          ]
        );
        button.addEventListener('click', () => void ctx.actions.ask(example.prompt));
        return button;
      })
    )
  ]);
  return h('aside', { class: 'dev-panel', 'data-node': 'dev-panel', 'aria-label': 'Developer readout' }, [
    examples,
    h('pre', {}, [JSON.stringify(payload, null, 2)])
  ]);
}
