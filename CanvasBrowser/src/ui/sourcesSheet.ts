/**
 * Sources sheet.
 *
 * Evidence lives here, in one bottom sheet behind a single control — never as
 * chrome in the world. Every row states how the claim is known.
 *
 * The sheet is deliberately a **warm light reading surface** while the worlds
 * stay dark: light performs best where sentences are read, dark performs best
 * where space and contrast carry meaning. That is a functional split, not a
 * theme, which is why there is no light/dark switch anywhere in the product.
 */
import { NEWS_SOURCE_NOTE } from '../newsFixtures';
import { MAP_LINKS, PROCESSING_RANGES, SEA_LINKS } from '../pickupFixtures';
import { AIRPORT_NOTES, MAP_LABEL, TRAFFIC_MAP_SOURCE } from '../journeyFixtures';
import {
  MICROSOFT_GRAPH_PROVIDER,
  providerDescriptor
} from '../intent-to-world/situation-intelligence/contextProviders';
import { describeTemplate } from '../intent-to-world/experience-synthesis/templateCompiler';
import { WEATHER_API_SOURCE } from '../travelConditionsFixtures';
import { formatClock, formatMinuteRange } from '../timeFormat';
import type { ContextProviderId } from '../intent-to-world/situation-graph';
import type { Citation, TruthKind } from '../types';
import { h } from './dom';
import type { ViewContext } from './state';

function row(truth: TruthKind, title: string, detail: string, link?: Citation): HTMLElement {
  return h('li', { class: 'source-row', 'data-truth': truth }, [
    h('span', { class: 'truth-chip', 'data-truth': truth }, [truth[0].toUpperCase() + truth.slice(1)]),
    h('div', { class: 'source-body' }, [
      h('p', { class: 'source-title' }, [title]),
      h('p', { class: 'source-detail' }, [detail]),
      link
        ? h('a', { class: 'world-link', href: link.url, target: '_blank', rel: 'noopener noreferrer' }, [link.url])
        : null
    ])
  ]);
}

/** Claim-level evidence for the Signal Field, preserving live/sample provenance. */
function newsRows(ctx: ViewContext): HTMLElement[] {
  const world = ctx.state.news.world;
  if (!world) return [];
  const rows: HTMLElement[] = [
    row(
      'inferred',
      `Signal Field — ${world.provenance === 'live' ? 'LIVE CONTEXT' : world.provenance === 'mixed' ? 'MIXED LIVE + SAMPLE' : 'SAMPLE DATA'}`,
      `${world.provenance === 'sample' ? NEWS_SOURCE_NOTE : 'Live rows were retrieved from the linked public sources; SAMPLE rows remain explicitly labelled.'} Centred on ${world.place.label} (${
        ctx.state.news.placeTruth === 'coarse-location'
          ? 'coarse category from your device, never stored'
          : ctx.state.news.placeTruth === 'chosen'
            ? 'you chose this place'
            : 'inferred sample place'
      }) · ${world.freshnessLine}`
    )
  ];

  for (const signal of world.signals) {
    rows.push(
      row(
        signal.truth,
        `${signal.headline} — ${signal.provenance === 'live' ? 'LIVE' : 'SAMPLE'}`,
        `${signal.detail} · ${signal.method} · ${signal.distanceLabel} · ${signal.stamp}${
          signal.retrievedAt ? ` · retrieved ${signal.retrievedAt}` : ''
        }`,
        signal.source ?? undefined
      )
    );
  }
  for (const entry of world.axis ?? []) {
    rows.push(
      row(
        entry.truth,
        `${entry.headline} — ${entry.provenance === 'live' ? 'LIVE' : 'SAMPLE'}`,
        `${entry.move} · ${entry.when} · ${entry.stamp}`,
        entry.source ?? undefined
      )
    );
  }
  for (const absence of world.absences) {
    rows.push(row('unknown', absence.title, `${absence.reason} ${absence.unblocker}`));
  }
  return rows;
}

/**
 * `Why this world` — the two engines, in their own words.
 *
 * Situation Intelligence says what it read, what information it wanted and
 * from whom, and which questions it refused to ask. Experience Synthesis says
 * what world that argued for and what it did with a model's opinion. Microsoft
 * Graph appears here as a *capability that is not connected*, with the fields
 * it would read and the reason — never as data, because there is none.
 */
function whyThisWorldRows(ctx: ViewContext): HTMLElement[] {
  const graph = ctx.state.situationGraph;
  const plan = ctx.state.experiencePlan;
  if (!graph) return [];
  const rows: HTMLElement[] = [];

  const hypotheses = graph.hypotheses
    .map((entry) => `${entry.label}${entry.supported ? '' : ' (not built yet)'}`)
    .join(' · ');
  const used = graph.informationNeeds.filter((need) => need.status === 'available' || need.status === 'satisfied');
  const planned = graph.informationNeeds.filter((need) => need.status === 'planned' || need.status === 'unavailable');
  const consentGated = graph.informationNeeds.filter((need) => need.status === 'needs-consent');
  const providerLabels = (ids: ContextProviderId[]): string =>
    [...new Set(ids)].map((id) => providerDescriptor(id).label).join(', ') || 'none';

  rows.push(
    row(
      'inferred',
      'Why this world · Situation Intelligence',
      [
        `Read as ${graph.kind}`,
        `job: ${graph.chosenJob ?? 'not chosen yet'}`,
        `hypotheses: ${hypotheses}`,
        `information used: ${providerLabels(used.map((need) => need.provider))}`,
        `planned or unavailable: ${providerLabels(planned.map((need) => need.provider))}`,
        `waiting on consent: ${providerLabels(consentGated.map((need) => need.provider))}`,
        `questions asked ${graph.questionPlan.asked.length} of a budget of ${graph.questionPlan.budget}; ${
          graph.questionPlan.verdicts.filter(
            (verdict) =>
              !verdict.selected && !graph.questionPlan.askedIds.includes(verdict.question.id)
          ).length
        } considered and refused`
      ].join(' · ')
    )
  );

  if (plan) {
    rows.push(
      row(
        'modeled',
        'Why this world · Experience Synthesis',
        [
          plan.templateLabel,
          `family ${plan.family}`,
          `blueprint: ${plan.blueprintSource === 'sol-generated' ? 'Sol-generated' : 'deterministic fallback'}`,
          ...plan.decisions.map((decision) => `${decision.outcome}: ${decision.detail}`),
          `visual forces: ${
            plan.visualForces.map((force) => `${force.id} (${force.truth}, ${force.authority})`).join(' · ') || 'none'
          }`,
          'This engine cannot fetch anything and cannot infer a fact. It reads the graph and compiles a template.'
        ].join(' · ')
      )
    );
  }

  const graphNeeds = graph.informationNeeds.filter((need) => need.provider === 'microsoft-graph');
  if (graphNeeds.length > 0) {
    rows.push(
      row(
        'unknown',
        `${MICROSOFT_GRAPH_PROVIDER.label} — Not connected`,
        [
          'Not connected · would use calendar/email/contact context for ' +
            graphNeeds.map((need) => need.purpose.replace(/\.$/, '')).join('; '),
          `scopes it would ask for: ${[...new Set(graphNeeds.map((need) => need.permission).filter(Boolean))].join(
            ', '
          )}`,
          'Nothing was requested and no account is linked, so none of this is shown as data.'
        ].join(' · ')
      )
    );
  }

  return rows;
}

export function renderSourcesSheet(ctx: ViewContext): HTMLDialogElement {
  const literal = ctx.state.literal;
  const reading = ctx.state.reading;
  const rows: HTMLElement[] = [];

  // The two engines account for themselves first: what was read, what was
  // asked for, what was refused, and what world that produced.
  rows.push(...whyThisWorldRows(ctx));
  // The world's own provenance comes first: which blueprint shaped this
  // template, and — just as importantly — which questions were considered and
  // refused, with the argument that refused them.
  const blueprint = ctx.state.blueprint;
  if (blueprint) {
    rows.push(
      row(
        blueprint.source === 'sol-generated' ? 'inferred' : 'modeled',
        `World blueprint: ${blueprint.source === 'sol-generated' ? 'Sol-generated' : 'fallback'}`,
        [
          `Template family ${blueprint.template.family}`,
          ctx.state.compiled ? describeTemplate(ctx.state.compiled) : null,
          blueprint.template.worldMetaphor,
          blueprint.source === 'sol-generated'
            ? 'A model proposed this blueprint. It was schema-checked, length-capped and markup-scrubbed on the wire and again in the browser.'
            : 'No model shaped this world. It is the deterministic blueprint this build always falls back to.',
          'A model may propose a blueprint here; it can never emit user interface. There is no field in this schema that could carry HTML, CSS, JavaScript, a selector or a style.'
        ]
          .filter(Boolean)
          .join(' · ')
      )
    );
    for (const verdict of ctx.state.questionVerdicts) {
      rows.push(
        row(
          verdict.selected ? 'inferred' : 'unknown',
          `Question ${verdict.selected ? 'asked' : 'not asked'}: ${verdict.question.prompt}`,
          [
            verdict.verdict,
            `expected gain ${verdict.question.expectedInformationGain} − your cost ${verdict.question.userCost} = ${verdict.score}`,
            verdict.question.materialEffect || 'no material effect was stated'
          ].join(' · ')
        )
      );
    }
  }

  if (ctx.state.news.world) {
    rows.push(...newsRows(ctx));
  }

  const travelEvidence = ctx.state.news.world === null;

  if (literal?.status === 'answered') {
    rows.push(
      row(
        reading?.truth === 'observed' ? 'observed' : 'unknown',
        'Live web research',
        [
          literal.model ? `${literal.model} · ${literal.contextTier} · ${literal.reasoningEffort} reasoning` : 'Live gateway',
          literal.retrievedAt ? `retrieved ${literal.retrievedAt}` : null,
          reading?.note ?? null
        ]
          .filter(Boolean)
          .join(' · ')
      )
    );
    for (const citation of literal.citations) {
      rows.push(row('observed', citation.label, 'Cited by the live answer. Read the page yourself before you rely on it.', citation));
    }
    if (literal.citations.length === 0) {
      rows.push(row('unknown', 'No claim-level source URL', 'The answer did not cite a page, so nothing here is marked observed.'));
    }
  } else if (travelEvidence) {
    rows.push(
      row(
        'unknown',
        'Live research unavailable',
        literal?.text ?? 'This build has no live gateway, so no live claim was retrieved.'
      )
    );
  }

  if (ctx.state.plan?.provenance === 'sample') {
    rows.push(
      row('inferred', 'Sample scenario (SAMPLE DATA)', 'A labelled offline arrival used to preview the resolved world. It is not a real flight reading.')
    );
  }

  if (travelEvidence) {
    const conditions = ctx.state.plan?.conditions ?? null;
    if (conditions) {
      const { weather, traffic } = conditions;
      rows.push(
        row(
          weather.truth,
          `Weather near SEA — ${conditions.label}`,
          [
            `${weather.condition}${weather.temperatureF === null ? '' : ` ${weather.temperatureF}°F`}`,
            weather.windMph === null ? null : `wind ${weather.windMph} mph`,
            weather.visibilityEffect,
            weather.widenMinutes > 0
              ? `Widens ${weather.widenedSegment} by ${weather.widenMinutes} min — the only effect weather is allowed to have here.`
              : 'No effect on the plan at this level.',
            weather.checkedAtMs === null ? 'never checked' : `checked ${formatClock(weather.checkedAtMs)}`,
            weather.note
          ]
            .filter(Boolean)
            .join(' · '),
          weather.source
        )
      );
      rows.push(
        row(
          'unknown',
          'No structured weather feed is wired up',
          'The live gateway returns prose, and prose is not promoted to a structured fact. A live build would read a forecast API directly.',
          WEATHER_API_SOURCE
        )
      );
      rows.push(
        row(
          traffic.truth,
          `Traffic on your corridor — ${conditions.label}`,
          [
            `${traffic.corridorLabel}: ${traffic.level}, ${traffic.trend}`,
            `adds ${formatMinuteRange(traffic.delayMinutes)} to the fixture drive range`,
            traffic.checkedAtMs === null ? 'never checked' : `checked ${formatClock(traffic.checkedAtMs)}`,
            traffic.note
          ].join(' · '),
          traffic.source
        )
      );
    }

    rows.push(
      row(
        'modeled',
        'Local processing ranges',
        `Taxi ${formatMinuteRange(PROCESSING_RANGES.taxi)} · deplane ${formatMinuteRange(
          PROCESSING_RANGES.deplane
        )} · CBP ${formatMinuteRange(PROCESSING_RANGES.cbp)} · bags ${formatMinuteRange(
          PROCESSING_RANGES.bags
        )} · curb walk ${formatMinuteRange(PROCESSING_RANGES.curb)}. Computed locally, no model call.`
      )
    );
    rows.push(
      row('modeled', 'Drive estimates', 'Fixture drive ranges by origin. CanvasBrowser has no live traffic source and does not claim one.')
    );
    rows.push(
      row(
        'inferred',
        `Route map — ${MAP_LABEL}`,
        'The route plane is drawn from local coordinates and hand-authored corridor waypoints. No map tiles are fetched and no map provider is contacted, so the geography is illustrative and labelled as such.',
        TRAFFIC_MAP_SOURCE
      )
    );
    for (const note of AIRPORT_NOTES) {
      rows.push(
        row(
          note.truth === 'official' ? 'observed' : 'modeled',
          `${note.label} — ${note.truth === 'official' ? 'official' : 'SAMPLE'}`,
          note.detail,
          note.source ?? undefined
        )
      );
    }
    if (ctx.state.plan?.stops.length) {
      rows.push(
        row(
          'inferred',
          'Stops you added',
          `${ctx.state.plan.stops
            .map((stop) => `${stop.label} ${formatMinuteRange(stop.minutes)}`)
            .join(' · ')}. SAMPLE estimates, computed on this device, applied to the drive range and the leave-by.`
        )
      );
    }
    for (const link of SEA_LINKS) {
      rows.push(row('observed', link.label, 'Official airport page. Opens only when you click it.', link));
    }
    for (const link of MAP_LINKS) {
      rows.push(row('inferred', link.label, 'A prepared directions link. Nothing is opened, sent, or navigated for you.', link));
    }
  }

  const close = h('button', { type: 'button', class: 'ghost-button', 'data-node': 'sources-close' }, ['Close']);
  const sheet = h(
    'dialog',
    { class: 'sheet', 'data-node': 'sources-sheet', 'data-surface': 'light', 'aria-label': 'Sources' },
    [
      h('div', { class: 'sheet-head' }, [
        h('h2', { class: 'sheet-title' }, ['Sources']),
        close
      ]),
      h('ul', { class: 'source-list' }, rows)
    ]
  ) as HTMLDialogElement;

  close.addEventListener('click', () => ctx.actions.closeSources());
  sheet.addEventListener('close', () => ctx.actions.closeSources());
  sheet.addEventListener('cancel', () => ctx.actions.closeSources());
  return sheet;
}
