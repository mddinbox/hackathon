/**
 * Home, the literal answer, and the honest "next template" handoff.
 *
 * Home is one question and one prompt — but it is not a search box on black.
 * Two authored world seeds orbit the prompt: a faint Time Terrain echo on one
 * side and Signal Field reach rings on the other. They are ambient, inert and
 * `aria-hidden`, so the page promises two different kinds of world without
 * becoming a gallery, a dashboard, or a set of template cards. The user's own
 * moment — local time and a coarse place — is stated quietly in the
 * composition, because both worlds are anchored to it.
 */
import { formatClock } from '../timeFormat';
import { fxCanvas } from '../visualEngine';
import { brandRow } from './chrome';
import { h } from './dom';
import type { ViewContext } from './state';

function promptForm(ctx: ViewContext, placeholder: string, nodeId: string): HTMLFormElement {
  const input = h('input', {
    type: 'text',
    class: 'prompt-input',
    'data-node': nodeId,
    id: nodeId,
    name: 'prompt',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder,
    value: ctx.state.prompt,
    'aria-label': 'What are you actually trying to do?'
  });
  const submit = h(
    'button',
    { type: 'submit', class: 'prompt-submit', 'data-node': `${nodeId}-ask` },
    [ctx.state.busy ? 'Working…' : 'Ask']
  );
  if (ctx.state.busy) submit.setAttribute('disabled', '');

  const form = h('form', { class: 'prompt-form', novalidate: true }, [input, submit]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    ctx.actions.setPrompt(input.value);
    void ctx.actions.ask(input.value);
  });
  input.addEventListener('input', () => ctx.actions.setPrompt(input.value));
  return form;
}

/** The Time Terrain seed: time running sideways, stages stacked in it. */
function terrainSeed(): HTMLElement {
  const lanes = [
    { start: 4, span: 26 },
    { start: 18, span: 34 },
    { start: 38, span: 30 },
    { start: 56, span: 24 },
    { start: 70, span: 22 }
  ].map((lane) => {
    const band = h('span', { class: 'seed-band' }, []);
    band.style.setProperty('--start', `${lane.start}%`);
    band.style.setProperty('--span', `${lane.span}%`);
    return h('span', { class: 'seed-lane' }, [band]);
  });

  const ticks = [0, 25, 50, 75, 100].map((percent) => {
    const tick = h('span', { class: 'seed-tick' }, []);
    tick.style.setProperty('--start', `${percent}%`);
    return tick;
  });

  return h('div', { class: 'world-seed world-seed--terrain', 'data-node': 'home-seed-terrain' }, [
    h('span', { class: 'seed-name' }, ['when']),
    h('div', { class: 'seed-axis' }, ticks),
    h('div', { class: 'seed-lanes' }, lanes)
  ]);
}

/** The Local News seed: a quiet map-like instrument grid with fixed forces. */
function fieldSeed(): HTMLElement {
  const grid = Array.from({ length: 9 }, (_, index) => {
    const line = h('span', {
      class: `seed-grid-line seed-grid-line--${index % 2 === 0 ? 'vertical' : 'horizontal'}`
    }, []);
    line.style.setProperty('--slot', String(index));
    return line;
  });

  const dots = [
    { x: 66, y: 30, layer: 'local' },
    { x: 78, y: 62, layer: 'markets' },
    { x: 36, y: 66, layer: 'weather' },
    { x: 30, y: 34, layer: 'mobility' },
    { x: 58, y: 82, layer: 'local' }
  ].map((dot) => {
    const node = h('span', { class: 'seed-signal', 'data-layer': dot.layer }, []);
    node.style.setProperty('--x', `${dot.x}%`);
    node.style.setProperty('--y', `${dot.y}%`);
    return node;
  });

  return h('div', { class: 'world-seed world-seed--field', 'data-node': 'home-seed-field' }, [
    h('span', { class: 'seed-name' }, ['what reaches me']),
    h('div', { class: 'seed-map' }, [...grid, h('span', { class: 'seed-center' }, []), ...dots])
  ]);
}

/** Both seeds, purely decorative, never clickable, never announced. */
function homeAmbient(): HTMLElement {
  return h(
    'div',
    { class: 'home-ambient', 'data-node': 'home-ambient', 'aria-hidden': 'true' },
    [terrainSeed(), fieldSeed()]
  );
}

function homeMoment(ctx: ViewContext): HTMLElement {
  const placeKnown = ctx.state.news.placeTruth !== 'inferred';
  const place = placeKnown
    ? h('span', { class: 'home-place', 'data-node': 'home-place' }, [ctx.state.news.place.label])
    : h(
        'button',
        { type: 'button', class: 'home-place home-place--action', 'data-node': 'home-use-location' },
        [ctx.state.autoLocationStatus === 'requesting' ? 'Locating…' : 'Use current location']
      );
  if (place instanceof HTMLButtonElement) {
    place.addEventListener('click', () => void ctx.actions.useHomeLocation());
  }
  return h('p', { class: 'home-moment', 'data-node': 'home-moment' }, [
    place,
    h('span', { class: 'home-moment-dot' }, ['·']),
    h('span', { class: 'home-clock', 'data-node': 'home-clock' }, [formatClock(Date.now())])
  ]);
}

export function renderHome(ctx: ViewContext): HTMLElement {
  return h('div', { class: 'shell shell--home', 'data-node': 'home' }, [
    brandRow(ctx, 'home'),
    h('main', { class: 'home-stage' }, [
      // The latent worlds are computed on the GPU beneath everything else: a
      // Time Terrain current on one side, a Signal Field on the other, joined
      // by one continuous field. Decorative, aria-hidden, never interactive.
      fxCanvas('home'),
      homeAmbient(),
      h('div', { class: 'home-focus' }, [
        homeMoment(ctx),
        h('h1', { class: 'display-question', 'data-node': 'display-question' }, [
          'What are you actually trying to do?'
        ]),
        promptForm(ctx, 'Ask anything real', 'home-prompt'),
        ctx.state.error ? h('p', { class: 'inline-error', role: 'status' }, [ctx.state.error]) : null
      ])
    ])
  ]);
}

function freshnessLine(ctx: ViewContext): HTMLElement | null {
  const literal = ctx.state.literal;
  if (!literal) return null;
  const bits: string[] = [];
  if (literal.model) bits.push(`${literal.model} · ${literal.contextTier} · ${literal.reasoningEffort} reasoning`);
  if (literal.retrievedAt) {
    const stamp = new Date(literal.retrievedAt);
    bits.push(`retrieved ${Number.isNaN(stamp.getTime()) ? literal.retrievedAt : stamp.toLocaleTimeString()}`);
  }
  if (bits.length === 0) return null;
  return h('p', { class: 'freshness', 'data-node': 'literal-freshness' }, [bits.join(' · ')]);
}

/** Renders the answer verbatim, with any cited URL turned into a real link. */
function linkifiedAnswer(text: string): HTMLElement {
  const body = h('p', { class: 'literal-answer-text' }, []);
  const pattern = /https?:\/\/[^\s)<>"']+/g;
  let cursor = 0;
  for (const match of text.matchAll(pattern)) {
    const url = match[0].replace(/[.,;)]+$/, '');
    const index = match.index ?? 0;
    if (index > cursor) body.append(document.createTextNode(text.slice(cursor, index)));
    body.append(
      h('a', { class: 'answer-link', href: url, target: '_blank', rel: 'noopener noreferrer' }, [
        url.replace(/^https?:\/\/(www\.)?/, '')
      ])
    );
    cursor = index + url.length;
  }
  if (cursor < text.length) body.append(document.createTextNode(text.slice(cursor)));
  return body;
}

/**
 * The one place a literal answer is still the default: an ambiguous news
 * question, where no world job has been chosen yet. The offer that follows is
 * the exception to world-first, not the rule.
 */
function newsOffer(ctx: ViewContext): HTMLElement {
  const question = ctx.state.news.question;
  const buttons = (question?.options ?? []).map((option) => {
    const button = h(
      'button',
      { type: 'button', class: 'hypothesis', 'data-node': `offer-${option.id}` },
      [
        h('span', { class: 'hypothesis-label' }, [option.label]),
        option.detail ? h('span', { class: 'hypothesis-note' }, [option.detail]) : null
      ]
    );
    button.addEventListener('click', () => ctx.actions.answerClarification(question!.id, option.id));
    return button;
  });

  return h(
    'section',
    { class: 'offer', 'data-node': 'news-offer', role: 'region', 'aria-label': 'Job hypotheses' },
    [
      h('p', { class: 'offer-question' }, [question?.question ?? 'Do you want that as an answer, or as your world?']),
      h('div', { class: 'offer-choices' }, buttons),
      h('p', { class: 'offer-note' }, ['Nothing opens until you choose.'])
    ]
  );
}

/** Track was chosen: the literal reading *is* the outcome, and it says so. */
function trackTrailer(ctx: ViewContext): HTMLElement {
  const openPickup = h('button', { type: 'button', class: 'hypothesis', 'data-node': 'track-open-pickup' }, [
    h('span', { class: 'hypothesis-label' }, ['Open the pickup world instead'])
  ]);
  openPickup.addEventListener('click', () => ctx.actions.chooseJob('pickup'));

  return h('section', { class: 'offer offer--resolved', 'data-node': 'track-arrival' }, [
    h('p', { class: 'offer-question' }, ['Tracking the arrival. The literal answer stays in front of you.']),
    h('div', { class: 'offer-choices' }, [openPickup]),
    h('p', { class: 'offer-note' }, ['Re-ask to refresh it. Nothing else is assembled unless you ask for it.'])
  ]);
}

export function renderLiteral(ctx: ViewContext): HTMLElement {
  const literal = ctx.state.literal;
  const answerText = literal?.text ?? '';
  const citations = literal?.citations ?? [];

  const answerBody = h('div', { class: 'literal-body' }, [linkifiedAnswer(answerText)]);

  const chosen = ctx.state.chosenJob;
  const news = ctx.state.news;
  const trailer = news.situation
    ? news.keptLiteral
      ? h('section', { class: 'offer offer--resolved', 'data-node': 'news-literal-kept' }, [
          h('p', { class: 'offer-question' }, ['Staying literal. The answer above is the whole result.']),
          h('p', { class: 'offer-note' }, [
            'Ask again to refresh it, or say “build my living briefing” to assemble the signal field.'
          ])
        ])
      : newsOffer(ctx)
    : chosen === 'track'
      ? trackTrailer(ctx)
      : null;

  const sources = h('button', { type: 'button', class: 'ghost-button', 'data-node': 'sources-button' }, ['Sources']);
  sources.addEventListener('click', () => ctx.actions.openSources());

  const back = h('button', { type: 'button', class: 'link-button', 'data-node': 'back-home' }, ['Start over']);
  back.addEventListener('click', () => ctx.actions.backHome());

  return h('div', { class: 'shell shell--literal', 'data-node': 'literal' }, [
    brandRow(ctx, 'home'),
    h('main', { class: 'literal-stage' }, [
      h(
        'section',
        {
          class: `literal${literal?.status === 'unavailable' ? ' literal--unavailable' : ''}`,
          'data-node': 'literal-answer',
          role: 'region',
          'aria-label': 'Literal answer'
        },
        [
          h('p', { class: 'literal-question' }, [ctx.state.literal?.prompt ?? '']),
          answerBody,
          freshnessLine(ctx),
          citations.length > 0
            ? h('p', { class: 'literal-citation-count' }, [
                `${citations.length} source${citations.length === 1 ? '' : 's'} cited`
              ])
            : null
        ]
      ),
      trailer,
      h('div', { class: 'literal-controls' }, [sources, back])
    ])
  ]);
}

/**
 * "Making a connection" resolves to the Coordination Constellation, which is
 * not built yet. Rather than a paragraph of apology, the answer is delivered
 * in a Travel-shaped world with the honest future-template result stated on
 * it, plus the two worlds that *do* exist right now.
 */
export function renderConnection(ctx: ViewContext): HTMLElement {
  const openPickup = h('button', { type: 'button', class: 'choice-card', 'data-node': 'connection-open-pickup' }, [
    h('span', { class: 'choice-card-label' }, ['Open the pickup world']),
    h('span', { class: 'choice-card-detail' }, ['Time Terrain · available now'])
  ]);
  openPickup.addEventListener('click', () => ctx.actions.chooseJob('pickup'));

  const track = h('button', { type: 'button', class: 'choice-card', 'data-node': 'connection-track' }, [
    h('span', { class: 'choice-card-label' }, ['Keep tracking this arrival']),
    h('span', { class: 'choice-card-detail' }, ['Literal reading · available now'])
  ]);
  track.addEventListener('click', () => ctx.actions.chooseJob('track'));

  const back = h('button', { type: 'button', class: 'link-button', 'data-node': 'back-home' }, ['Start over']);
  back.addEventListener('click', () => ctx.actions.backHome());

  const constellation = h('div', { class: 'constellation', 'aria-hidden': 'true' }, [
    ...[
      { x: 16, y: 30 },
      { x: 38, y: 62 },
      { x: 55, y: 24 },
      { x: 72, y: 58 },
      { x: 88, y: 36 }
    ].map((point) => {
      const node = h('span', { class: 'constellation-node' }, []);
      node.style.setProperty('--x', `${point.x}%`);
      node.style.setProperty('--y', `${point.y}%`);
      return node;
    }),
    h('span', { class: 'constellation-arc' }, [])
  ]);

  return h('div', { class: 'shell shell--clarify shell--travel-clarify', 'data-node': 'connection-shell' }, [
    brandRow(ctx, 'world'),
    h(
      'main',
      {
        class: 'clarify-stage clarify-stage--travel',
        'data-node': 'connection-notice',
        role: 'region',
        'aria-label': 'Coordination constellation'
      },
      [
        constellation,
        h('div', { class: 'clarify-copy' }, [
          h('p', { class: 'clarify-read' }, [ctx.state.situation?.flightLabel ?? 'Inbound flight']),
          h('h1', { class: 'clarify-question' }, ['A connection is a Coordination Constellation.']),
          h('p', { class: 'clarify-lede' }, [
            'That world plots two moving people against one shared deadline. It is the next template, and it is not in this P0 — so nothing here will pretend to hold your connection together.'
          ]),
          h('div', { class: 'clarify-choices' }, [openPickup, track]),
          back
        ])
      ]
    )
  ]);
}
