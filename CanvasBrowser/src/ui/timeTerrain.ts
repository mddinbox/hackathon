/**
 * The pickup world surface.
 *
 * The blueprint resolves an airport pickup to **Journey World**: a hybrid
 * time-and-space template. This module composes it —
 *
 *   - the route map is the dominant plane once an origin exists, and states
 *     the spatial gap honestly before that;
 *   - the arrival-processing **Time Terrain** is kept, compressed, as a linked
 *     strip beneath it, so the airport half of the problem shares one screen
 *     and one clock with the drive half;
 *   - the warm decision envelope is still the single dominant object.
 *
 * The `Journey` / `Timeline` lens only decides which of the two planes gets
 * the height. Neither one is a separate page, and neither is a card grid.
 */
import { renderJourneyMap } from './journeyWorld';
import { motionSentence, motionState, refreshIsDue } from '../motion';
import { CELL_PHONE_LOT, MAP_LINKS, ORIGIN_OPTIONS, ORIGIN_VALUE_COPY, SEA_CURB_RULE, SEA_LINKS, bagRationale } from '../pickupFixtures';
import { positionPercent, spanPercent } from '../pickupPlanner';
import { describeCadence, refreshCountdown } from '../refreshPolicy';
import {
  describeTemplate,
  type CompiledTemplate
} from '../intent-to-world/experience-synthesis/templateCompiler';
import { trafficLabel, weatherEffectLabel, weatherLabel } from '../travelConditionsFixtures';
import { formatClock, formatMinuteRange, formatRangeLabel } from '../timeFormat';
import type {
  ConditionLayers,
  FlightPhase,
  PickupPlan,
  TerrainSegment,
  TimeRange,
  TravelConditions,
  TruthKind
} from '../types';
import { fxCanvas } from '../visualEngine';
import { brandRow } from './chrome';
import { h } from './dom';
import type { JourneyLens, ViewContext } from './state';

const TRUTH_LABEL: Record<TruthKind, string> = {
  observed: 'Observed',
  modeled: 'Modeled',
  inferred: 'Inferred',
  unknown: 'Unknown'
};

const PHASE_LABEL: Record<FlightPhase, string> = {
  scheduled: 'Scheduled',
  enroute: 'En route',
  landed: 'On the ground',
  'at-gate': 'At the gate',
  unknown: 'Status unknown'
};

const MINUTE = 60_000;

function tickTimes(horizon: TimeRange): number[] {
  const span = horizon.endMs - horizon.startMs;
  const stepMinutes = span > 3 * 60 * MINUTE ? 60 : span > 90 * MINUTE ? 30 : 15;
  const step = stepMinutes * MINUTE;
  const first = Math.ceil(horizon.startMs / step) * step;
  const ticks: number[] = [];
  for (let t = first; t <= horizon.endMs; t += step) ticks.push(t);
  return ticks;
}

function axis(plan: PickupPlan): HTMLElement {
  const ticks = tickTimes(plan.horizon).map((ms) => {
    const tick = h('li', { class: 'tick' }, [h('span', { class: 'tick-label' }, [formatClock(ms)])]);
    tick.style.setProperty('--start', `${positionPercent(plan.horizon, ms)}%`);
    return tick;
  });
  return h('ul', { class: 'axis', 'data-node': 'terrain-axis', 'aria-hidden': 'true' }, ticks);
}

function nowRule(plan: PickupPlan): HTMLElement {
  const rule = h('div', { class: 'now-rule', 'data-node': 'now-rule' }, [
    h('span', { class: 'now-flag' }, ['NOW']),
    h('span', { class: 'now-time' }, [formatClock(plan.nowMs)])
  ]);
  rule.style.setProperty('--start', `${positionPercent(plan.horizon, plan.nowMs)}%`);
  return rule;
}

function segmentItem(plan: PickupPlan, segment: TerrainSegment): HTMLElement {
  const hatched = segment.truth === 'unknown' || segment.uncertainty >= 0.99;
  const band = h('span', { class: 'segment-band', 'aria-hidden': 'true' });
  band.style.setProperty('--start', `${positionPercent(plan.horizon, segment.range.startMs)}%`);
  band.style.setProperty('--span', `${spanPercent(plan.horizon, segment.range)}%`);

  // The range sits above its band, never inside it, so a narrow band cannot
  // swallow its own numbers.
  const rangeLabel = h('span', { class: 'segment-range' }, [
    plan.resolved
      ? `${formatRangeLabel(segment.range)} · ${formatMinuteRange(segment.duration)}`
      : `${formatMinuteRange(segment.duration)} · no anchor yet`
  ]);
  rangeLabel.style.setProperty('--start', `${positionPercent(plan.horizon, segment.range.startMs)}%`);

  return h(
    'li',
    {
      class: 'segment',
      'data-node': `segment-${segment.id}`,
      'data-truth': segment.truth,
      'data-hatch': hatched ? 'true' : 'false'
    },
    [
      h('div', { class: 'segment-info' }, [
        h('span', { class: 'segment-label' }, [segment.label]),
        h('span', { class: 'segment-method' }, [segment.method])
      ]),
      // Truth is carried by the material of the bar itself — colour, fill and
      // hatch — with one legend under the terrain. No repeated chip column.
      h('div', { class: 'segment-track' }, [rangeLabel, band])
    ]
  );
}

/**
 * The `Situation now` line: one compact sentence, never a panel.
 *
 * Phase, weather, traffic and the watch status in a single row above the
 * world, so the person can see at a glance what is currently true and when the
 * world will look again. It stays typographically secondary — the timetable
 * below it is still the dominant object.
 */
function situationNow(ctx: ViewContext, plan: PickupPlan): HTMLElement {
  const conditions = plan.conditions;
  const parts: HTMLElement[] = [
    h('span', { class: 'now-part now-part--phase', 'data-node': 'situation-phase' }, [PHASE_LABEL[plan.phase]])
  ];

  if (conditions) {
    parts.push(
      h('span', { class: 'now-part', 'data-node': 'situation-weather', 'data-kind': conditions.weather.kind }, [
        weatherLabel(conditions.weather),
        h('span', { class: 'sample-tag sample-tag--inline' }, ['SAMPLE'])
      ])
    );
    parts.push(
      h('span', { class: 'now-part', 'data-node': 'situation-traffic', 'data-level': conditions.traffic.level }, [
        trafficLabel(conditions.traffic),
        h('span', { class: 'sample-tag sample-tag--inline' }, ['SAMPLE'])
      ])
    );
  }

  parts.push(refreshStatus(ctx, plan));

  return h(
    'p',
    { class: 'situation-now', 'data-node': 'situation-now', role: 'status' },
    parts.flatMap((part, index) => (index === 0 ? [part] : [h('span', { class: 'now-sep', 'aria-hidden': 'true' }, ['·']), part]))
  );
}

/**
 * `Checked 6:00 AM · next in 14 min · every 15 min because …`
 *
 * The dial beside it is the same number as a shape: it drains as the next
 * check comes due, so the cadence is visible without reading the sentence.
 */
function refreshStatus(ctx: ViewContext, plan: PickupPlan): HTMLElement {
  const refresh = ctx.state.refresh;
  const cadence = describeCadence({
    intervalMs: refresh.intervalMs,
    nextRefreshMs: refresh.nextCheckMs,
    reason: refresh.reason,
    urgency: refresh.urgency
  });

  const words: string[] = [];
  if (refresh.lastCheckedMs !== null) words.push(`Checked ${formatClock(refresh.lastCheckedMs)}`);
  if (refresh.urgency === 'stopped') {
    words.push('not checking again');
  } else if (refresh.paused) {
    words.push('paused while this tab is hidden');
  } else if (refresh.nextCheckMs !== null) {
    const minutes = Math.max(0, Math.round((refresh.nextCheckMs - plan.nowMs) / MINUTE));
    words.push(`next in ${minutes} min`);
  }
  words.push(cadence);

  const remaining = refreshCountdown(plan.nowMs, refresh.lastCheckedMs, refresh.nextCheckMs);
  const dial = h('span', { class: 'refresh-dial', 'data-node': 'refresh-dial', 'aria-hidden': 'true' });
  dial.style.setProperty('--remaining', `${Math.round(remaining * 100)}`);

  return h(
    'span',
    {
      class: 'now-part now-part--refresh',
      'data-node': 'refresh-status',
      'data-urgency': refresh.urgency,
      // The dial drains at every cadence; it only *beats* when the next check
      // is actually due, which is the moment it wants a look.
      'data-due': refreshIsDue(refresh, plan.nowMs) ? 'true' : 'false',
      'data-checks': String(refresh.checks)
    },
    [dial, h('span', {}, [words.join(' · ')])]
  );
}

/**
 * Weather and traffic drawn as **forces over the world**, not cards.
 *
 * Weather is an atmospheric wash across the airport-processing horizon, with
 * its streaks running along the wind bearing. Traffic is a flow deformation
 * along the user's own travel lane. Each carries exactly one compact label,
 * anchored where its force acts.
 */
function conditionLayers(ctx: ViewContext, plan: PickupPlan, conditions: TravelConditions): HTMLElement[] {
  const visible: ConditionLayers = ctx.state.conditionLayers;
  const layers: HTMLElement[] = [];

  if (visible.weather) {
    const weather = conditions.weather;
    const wash = h('div', {
      class: 'weather-layer',
      'data-node': 'weather-layer',
      'data-kind': weather.kind,
      'aria-hidden': 'true'
    });
    wash.style.setProperty('--weather', String(Math.round((weather.precipitationChance ?? 0) * 100) / 100));
    wash.style.setProperty('--wind-angle', `${(weather.windFromDegrees ?? 180) + 180}deg`);
    wash.style.setProperty('--wind', String(Math.min(1, (weather.windMph ?? 0) / 35)));
    layers.push(wash);

    const label = h(
      'p',
      { class: 'condition-label condition-label--weather', 'data-node': 'weather-label', 'data-kind': weather.kind },
      [
        `${weatherLabel(weather)} · ${weatherEffectLabel(weather)}`,
        h('span', { class: 'sample-tag sample-tag--inline' }, ['SAMPLE'])
      ]
    );
    layers.push(label);
  }

  if (visible.traffic) {
    const traffic = conditions.traffic;
    const flow = h('div', {
      class: 'traffic-layer',
      'data-node': 'traffic-layer',
      'data-level': traffic.level,
      'data-trend': traffic.trend,
      'aria-hidden': 'true'
    });
    flow.style.setProperty('--load', String(traffic.congestion));
    if (plan.travel) {
      flow.style.setProperty('--start', `${positionPercent(plan.horizon, plan.travel.range.startMs)}%`);
      flow.style.setProperty('--span', `${spanPercent(plan.horizon, plan.travel.range)}%`);
    } else {
      flow.style.setProperty('--start', '0%');
      flow.style.setProperty('--span', '100%');
    }
    layers.push(flow);
  }

  return layers;
}

/**
 * The switches for those two forces, and the honest caveat next to them:
 * hiding a layer hides the drawing, never the effect. A person cannot make
 * the plan calmer by looking away from the weather.
 */
function layerSwitches(ctx: ViewContext, conditions: TravelConditions): HTMLElement {
  const entries: Array<{ id: keyof ConditionLayers; label: string }> = [
    { id: 'weather', label: 'Weather' },
    { id: 'traffic', label: 'Traffic' }
  ];
  return h('div', { class: 'condition-switches', 'data-node': 'condition-switches' }, [
    ...entries.map((entry) => {
      const on = ctx.state.conditionLayers[entry.id];
      const button = h(
        'button',
        {
          type: 'button',
          class: 'condition-switch',
          'data-node': `layer-${entry.id}`,
          'aria-pressed': on ? 'true' : 'false'
        },
        [entry.label]
      );
      button.addEventListener('click', () => ctx.actions.toggleConditionLayer(entry.id));
      return button;
    }),
    h('span', { class: 'condition-switch-note', 'data-node': 'layer-note' }, [
      `${conditions.label} · hiding a layer hides the drawing, not its effect on the plan`
    ])
  ]);
}

/**
 * What the motion means — and, when the world is still, that it is still.
 *
 * The clauses are not a description of the template's ambitions. They are
 * generated from the same `motionState` the GPU layer is driven by, so the
 * legend lists exactly what is moving at this moment and nothing else.
 */
function motionLegend(ctx: ViewContext): HTMLElement {
  const motion = motionState(ctx.state);
  return h(
    'p',
    { class: 'motion-legend', 'data-node': 'motion-legend', 'data-motion': motion.active.join(',') },
    [motionSentence(motion.active)]
  );
}

/**
 * The lens switch.
 *
 * Both lenses show the same world; the switch only moves the height between
 * the route plane and the arrival strip. Journey is the default because the
 * natural next need after "be in the cell phone lot between 6:45 and 7:05" is
 * the route that gets you there, not a second reading of the timetable.
 */
function lensSwitch(ctx: ViewContext): HTMLElement {
  const options: Array<{ id: JourneyLens; label: string; detail: string }> = [
    { id: 'journey', label: 'Journey', detail: 'route over a linked arrival strip' },
    { id: 'timeline', label: 'Timeline', detail: 'the arrival processing, full height' }
  ];
  const buttons = options.map((option) => {
    const on = ctx.state.lens === option.id;
    const button = h(
      'button',
      {
        type: 'button',
        class: 'lens-button',
        'data-node': `lens-${option.id}`,
        'aria-pressed': on ? 'true' : 'false',
        title: option.detail
      },
      [option.label]
    );
    button.addEventListener('click', () => ctx.actions.setLens(option.id));
    return button;
  });

  const compiled = ctx.state.compiled;
  return h('div', { class: 'lens-row', 'data-node': 'lens-row' }, [
    ...buttons,
    h('span', { class: 'lens-note', 'data-node': 'lens-note' }, [
      compiled ? describeTemplate(compiled) : 'Journey World',
      ' · ',
      ctx.state.blueprint?.source === 'sol-generated'
        ? 'blueprint: Sol-generated'
        : 'blueprint: fallback'
    ])
  ]);
}

export function renderTerrain(ctx: ViewContext): HTMLElement {
  const plan = ctx.state.plan;
  if (!plan) return h('div', { class: 'shell' }, []);

  const lens = ctx.state.lens;
  const compiled = ctx.state.compiled;
  const journey = ctx.state.journey;
  const showMap = lens === 'journey' && journey !== null;

  const sources = h('button', { type: 'button', class: 'ghost-button', 'data-node': 'sources-button' }, ['Sources']);
  sources.addEventListener('click', () => ctx.actions.openSources());

  const back = h('button', { type: 'button', class: 'link-button', 'data-node': 'back-home' }, ['Start over']);
  back.addEventListener('click', () => ctx.actions.backHome());

  const overlayChildren: Array<HTMLElement | null> = [nowRule(plan)];
  if (plan.resolved && ctx.state.reading?.landingMs) {
    const landingMs = ctx.state.reading.landingMs;
    const marker = h('div', { class: 'landing-marker', 'data-node': 'landing-marker', 'data-truth': 'observed' }, [
      h('span', { class: 'landing-dot', 'aria-hidden': 'true' }),
      h('span', { class: 'landing-label' }, [`Landed ${formatClock(landingMs)}`])
    ]);
    marker.style.setProperty('--start', `${positionPercent(plan.horizon, landingMs)}%`);
    overlayChildren.push(marker);
  }

  // The arrival-processing terrain. In the Journey lens it is compressed into
  // a linked strip under the map; in the Timeline lens it takes the height.
  // Only one GPU canvas is ever mounted, so the strip has none of its own.
  const world = h(
    'div',
    {
      class: `world${showMap ? ' world--strip' : ''}`,
      'data-node': 'world',
      'data-surface': 'dark',
      'data-lens': lens,
      'data-revision': String(ctx.state.worldRevision)
    },
    [
      showMap ? null : fxCanvas('travel'),
      h('div', { class: 'world-grain', 'aria-hidden': 'true' }),
      // Weather and traffic are forces laid over the whole world, under the
      // semantic bands — never cards beside them.
      ...(plan.conditions ? conditionLayers(ctx, plan, plan.conditions) : []),
      showMap
        ? h('p', { class: 'strip-title', 'data-node': 'strip-title' }, [
            'Arrival processing · landing → gate → CBP → bags → curb-ready'
          ])
        : null,
      axis(plan),
      h('div', { class: 'world-overlay' }, overlayChildren),
      h(
        'ol',
        { class: 'lane lane--pipeline', 'data-node': 'pipeline' },
        plan.segments.map((segment) => segmentItem(plan, segment))
      ),
      travelLane(ctx, plan, !showMap),
      truthLegend()
    ]
  );

  return h(
    'div',
    { class: 'shell shell--world', 'data-node': 'terrain-shell', 'data-lens': lens },
    [
      brandRow(ctx, 'world'),
      h(
        'main',
        {
          class: 'terrain',
          'data-node': 'time-terrain',
          'data-lens': lens,
          role: 'region',
          'aria-label': 'Journey world'
        },
        [
          h('div', { class: 'terrain-head' }, [
            assumptionChips(ctx),
            situationNow(ctx, plan),
            lensSwitch(ctx),
            plan.provenance === 'sample'
              ? h('p', { class: 'sample-banner', 'data-node': 'sample-badge' }, [
                  h('span', { class: 'sample-tag' }, ['SAMPLE DATA']),
                  'This world is a labelled preview scenario, not live research.'
                ])
              : null
          ]),
          showMap && journey && compiled
            ? renderJourneyMap({ ctx, plan, world: journey, compiled })
            : null,
          world,
          plan.conditions
            ? h('div', { class: 'world-foot' }, [layerSwitches(ctx, plan.conditions), motionLegend(ctx)])
            : null,
          plan.resolved && plan.envelope ? resolvedEnvelope(ctx, plan) : unknownEnvelope(ctx, plan),
          h('div', { class: 'terrain-controls' }, [followUp(ctx), sources, whatChanged(ctx), back])
        ]
      )
    ]
  );
}

function travelLane(ctx: ViewContext, plan: PickupPlan, offerOrigin: boolean): HTMLElement {
  const trackChildren: Array<HTMLElement | null> = [];

  if (plan.travel) {
    const block = h('div', { class: 'travel-block', 'data-node': 'travel-block', 'data-truth': plan.travel.truth }, [
      h('span', { class: 'travel-text' }, [`${formatMinuteRange(plan.travel.driveMinutes)} · estimated, not live traffic`])
    ]);
    block.style.setProperty('--start', `${positionPercent(plan.horizon, plan.travel.range.startMs)}%`);
    block.style.setProperty('--span', `${spanPercent(plan.horizon, plan.travel.range)}%`);
    trackChildren.push(block);

    // The traffic force gets exactly one label, anchored to the drive block.
    const traffic = plan.conditions?.traffic;
    if (traffic && ctx.state.conditionLayers.traffic) {
      const label = h(
        'p',
        {
          class: 'condition-label condition-label--traffic',
          'data-node': 'traffic-label',
          'data-level': traffic.level,
          'data-trend': traffic.trend
        },
        [
          `${trafficLabel(traffic)} · +${formatMinuteRange(traffic.delayMinutes)} on ${traffic.corridorLabel}`,
          h('span', { class: 'sample-tag sample-tag--inline' }, ['SAMPLE'])
        ]
      );
      label.style.setProperty('--start', `${positionPercent(plan.horizon, plan.travel.range.startMs)}%`);
      trackChildren.push(label);
    }
  }

  if (plan.lotStagingMs !== null) {
    const marker = h('div', { class: 'lot-marker', 'data-node': 'lot-marker' }, [
      h('span', { class: 'lot-dot', 'aria-hidden': 'true' }),
      h('span', { class: 'lot-label' }, [CELL_PHONE_LOT.name])
    ]);
    marker.style.setProperty('--start', `${positionPercent(plan.horizon, plan.lotStagingMs)}%`);
    trackChildren.push(marker);
  }

  const needsOrigin = ctx.state.origin === null;
  if (needsOrigin) {
    trackChildren.push(
      // The origin request lives in exactly one place at a time: on the route
      // plane when the map is up, here when the Timeline lens has the height.
      !offerOrigin
        ? h('p', { class: 'lane-empty', 'data-node': 'travel-empty' }, [
            'Your route is waiting on a starting point — the map above is asking for it.'
          ])
        : plan.resolved
          ? originPicker(ctx)
          : h('p', { class: 'lane-empty', 'data-node': 'travel-empty' }, [
              'Your travel block stays empty until an actual landing time exists.'
            ])
    );
  }

  return h('div', { class: 'lane lane--you' }, [
    h('div', { class: 'segment-info', 'data-node': 'travel-label' }, [
      h('span', { class: 'segment-label' }, [
        plan.travel ? `Your drive from ${plan.travel.originLabel}` : 'Your travel block'
      ]),
      h('span', { class: 'segment-method' }, [
        plan.travel ? plan.travel.method : 'Nothing is assumed about where you are starting from.'
      ])
    ]),
    h('div', { class: `lane-track${needsOrigin ? ' lane-track--ask' : ''}` }, trackChildren)
  ]);
}

/**
 * The situation sentence, under the question-economics rule.
 *
 * Two things changed here and both are product decisions, not layout:
 *
 *   - **passenger count is gone.** Its honest effect is a few minutes of
 *     assembly at the curb; it moves no template, route, envelope or handoff,
 *     so it is inferred at one, corrected only if the person says otherwise in
 *     their own words, and never surfaced as a control or a question.
 *   - **the checked bag states its own stakes.** It genuinely moves
 *     curb-ready by 12–28 minutes and can change whether the car fits the
 *     luggage, so it stays visible — as a one-click assumption with its
 *     consequence written next to it, never as a modal that blocks the world.
 */
function assumptionChips(ctx: ViewContext): HTMLElement {
  const { assumptions } = ctx.state;

  const bags = h(
    'button',
    {
      type: 'button',
      class: 'assumption',
      'data-node': 'assumption-bags',
      'data-truth': 'inferred',
      'aria-pressed': assumptions.checkedBag ? 'true' : 'false'
    },
    [assumptions.checkedBag ? 'a checked bag' : 'no checked bag']
  );
  bags.addEventListener('click', () => ctx.actions.toggleCheckedBag());

  const arrival = h(
    'button',
    { type: 'button', class: 'assumption', 'data-node': 'assumption-arrival', 'data-truth': 'inferred' },
    [assumptions.internationalArrival ? 'an international arrival' : 'a domestic arrival']
  );
  arrival.addEventListener('click', () => ctx.actions.toggleArrivalKind());

  return h('div', { class: 'situation-block' }, [
    h('p', { class: 'situation', 'data-node': 'situation-sentence' }, [
      h('span', { class: 'situation-flight' }, [ctx.state.plan?.flightLabel ?? 'Inbound flight']),
      document.createTextNode(' · '),
      document.createTextNode(
        ctx.state.plan?.resolved && ctx.state.reading?.landingMs
          ? `landed ${formatClock(ctx.state.reading.landingMs)}. `
          : 'landing not established yet. '
      ),
      document.createTextNode('You are meeting them with '),
      bags,
      document.createTextNode(', on '),
      arrival,
      document.createTextNode('.')
    ]),
    h('p', { class: 'assumption-why', 'data-node': 'assumption-bags-why' }, [bagRationale(assumptions.checkedBag)])
  ]);
}

function originPicker(ctx: ViewContext): HTMLElement {
  const { locationState, placesVisible } = ctx.state;
  const question =
    ctx.state.travelQuestion?.id === 'travel-origin' ? ctx.state.travelQuestion : null;

  const useLocation = h(
    'button',
    { type: 'button', class: 'primary-button', 'data-node': 'use-my-location' },
    ['Use my location']
  );
  useLocation.addEventListener('click', () => void ctx.actions.useMyLocation());

  const choosePlace = h('button', { type: 'button', class: 'ghost-button', 'data-node': 'choose-place' }, [
    'Choose a place instead'
  ]);
  choosePlace.addEventListener('click', () => ctx.actions.showPlaces());

  const notice =
    locationState === 'denied' ||
    locationState === 'unsupported' ||
    locationState === 'outside-region' ||
    locationState === 'timeout'
      ? h('p', { class: 'origin-notice', 'data-node': 'location-fallback', role: 'status' }, [
          locationState === 'denied'
            ? 'Location is off, so pick a starting point instead.'
            : locationState === 'timeout'
              ? 'Location took too long, so pick a starting point instead.'
              : locationState === 'outside-region'
                ? 'Current location is outside this prototype’s supported region, so pick a starting point instead.'
              : 'This browser cannot share location, so pick a starting point instead.'
        ])
      : null;

  const places = placesVisible
    ? h(
        'ul',
        { class: 'place-list', 'data-node': 'place-options' },
        ORIGIN_OPTIONS.map((option) => {
          const button = h('button', { type: 'button', class: 'place', 'data-node': `origin-${option.id}` }, [
            h('span', { class: 'place-name' }, [option.label]),
            h('span', { class: 'place-drive' }, [`${formatMinuteRange(option.driveMinutes)} est.`])
          ]);
          button.addEventListener('click', () => ctx.actions.chooseOrigin(option.id));
          return h('li', {}, [button]);
        })
      )
    : null;

  const typedInput = h('input', {
    type: 'text',
    class: 'origin-input',
    'data-node': 'origin-text',
    'aria-label': 'Other starting point',
    placeholder: 'Somewhere else'
  });
  const typedForm = placesVisible
    ? h('form', { class: 'origin-form' }, [
        typedInput,
        h('button', { type: 'submit', class: 'ghost-button', 'data-node': 'origin-text-submit' }, ['Use this'])
      ])
    : null;
  typedForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    if (typedInput.value.trim()) ctx.actions.chooseTypedOrigin(typedInput.value.trim());
  });

  return h('section', { class: 'origin-picker', 'data-node': 'origin-picker' }, [
    h(
      'p',
      {
        class: 'origin-question',
        'data-node': question ? 'origin-question' : 'origin-status'
      },
      [
        question?.question ??
          (locationState === 'requesting'
            ? 'Locating your starting point…'
            : 'The route still needs a starting point.')
      ]
    ),
    h('p', { class: 'origin-why', 'data-node': 'origin-why' }, [question?.reason ?? ORIGIN_VALUE_COPY]),
    notice,
    h('div', { class: 'origin-actions' }, [useLocation, placesVisible ? null : choosePlace]),
    places,
    typedForm,
    h('p', { class: 'origin-note' }, [
      'Drive times are local fixture estimates. CanvasBrowser has no live traffic source, and your coordinates never leave this device.'
    ])
  ]);
}

function linkRow(): HTMLElement {
  const links = [...MAP_LINKS, ...SEA_LINKS].map((link) =>
    h('li', {}, [
      h(
        'a',
        { class: 'world-link', href: link.url, target: '_blank', rel: 'noopener noreferrer', 'data-node': 'world-link' },
        [link.label]
      )
    ])
  );
  return h('ul', { class: 'link-row', 'data-node': 'pickup-links' }, links);
}

function resolvedEnvelope(ctx: ViewContext, plan: PickupPlan): HTMLElement {
  const envelope = plan.envelope!;
  return h(
    'section',
    {
      class: 'envelope',
      'data-node': 'decision-envelope',
      'data-surface': 'light',
      role: 'region',
      'aria-label': 'Decision envelope',
      'data-truth': envelope.truth
    },
    [
      h('p', { class: 'envelope-primary', 'data-node': 'envelope-primary' }, [envelope.primary]),
      h('p', { class: 'envelope-secondary', 'data-node': 'envelope-secondary' }, [envelope.secondary]),
      plan.travel
        ? h('p', { class: 'envelope-secondary', 'data-node': 'envelope-travel' }, [
            plan.travel.lateForIdealWindow
              ? `Leave ${plan.travel.originLabel} now — expected Cell Phone Lot arrival ${formatRangeLabel(
                  plan.travel.arrivalWindow
                )}.`
              : `Leave ${plan.travel.originLabel} by ${formatClock(
                  plan.travel.departByMs
                )} to make that window (${formatMinuteRange(plan.travel.driveMinutes)} estimated).`
          ])
        : null,
      h('p', { class: 'envelope-method', 'data-node': 'envelope-method' }, [
        `${TRUTH_LABEL[envelope.truth]} · ${envelope.method}`
      ]),
      envelope.conditionNotes.length > 0
        ? h(
            'ul',
            { class: 'envelope-conditions', 'data-node': 'envelope-conditions' },
            envelope.conditionNotes.map((note) => h('li', {}, [note]))
          )
        : null,
      h('p', { class: 'envelope-rule', 'data-node': 'curb-rule' }, [SEA_CURB_RULE]),
      linkRow()
    ]
  );
}

function unknownEnvelope(ctx: ViewContext, plan: PickupPlan): HTMLElement {
  const recheck = h('button', { type: 'button', class: 'primary-button', 'data-node': 'recheck' }, [
    'Re-check arrival status'
  ]);
  recheck.addEventListener('click', () => void ctx.actions.recheck());

  const preview = h('button', { type: 'button', class: 'ghost-button', 'data-node': 'preview-sample' }, [
    'Preview resolved scenario',
    h('span', { class: 'sample-tag' }, ['SAMPLE DATA'])
  ]);
  preview.addEventListener('click', () => ctx.actions.previewSample());

  return h(
    'section',
    {
      class: 'envelope envelope--unknown',
      'data-node': 'unknown-envelope',
      'data-surface': 'light',
      role: 'region',
      'aria-label': 'Decision envelope',
      'data-truth': 'unknown'
    },
    [
      h('p', { class: 'envelope-primary', 'data-node': 'envelope-primary' }, ['Not enough to commit yet']),
      h('p', { class: 'envelope-secondary' }, [plan.blocked?.reason ?? 'No actual landing time is established.']),
      h('p', { class: 'envelope-method' }, [
        'Unknown · CanvasBrowser will not shape a leave time out of a scheduled or estimated arrival.'
      ]),
      h('div', { class: 'envelope-actions' }, [recheck, preview]),
      linkRow()
    ]
  );
}

function whatChanged(ctx: ViewContext): HTMLElement {
  const entries = ctx.state.changes;
  const undo = h('button', { type: 'button', class: 'link-button', 'data-node': 'undo-change' }, ['Undo last']);
  undo.addEventListener('click', () => ctx.actions.undoChange());
  if (entries.length === 0) undo.setAttribute('disabled', '');

  return h('details', { class: 'what-changed', 'data-node': 'what-changed' }, [
    h('summary', {}, [`What changed (${entries.length})`]),
    entries.length === 0
      ? h('p', { class: 'muted' }, ['Nothing has been changed in this world yet.'])
      : h(
          'ol',
          { class: 'change-list' },
          entries.map((entry) => h('li', {}, [entry.label]))
        ),
    undo
  ]);
}

function followUp(ctx: ViewContext): HTMLElement {
  const input = h('input', {
    type: 'text',
    class: 'followup-input',
    'data-node': 'terrain-followup',
    'aria-label': 'Change an assumption',
    placeholder: 'no checked bag'
  });
  const form = h('form', { class: 'followup' }, [
    input,
    h('button', { type: 'submit', class: 'ghost-button', 'data-node': 'terrain-followup-apply' }, ['Apply'])
  ]);
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const applied = ctx.actions.editAssumptions(input.value);
    if (applied) input.value = '';
  });
  return form;
}

function truthLegend(): HTMLElement {
  const items: TruthKind[] = ['observed', 'modeled', 'inferred', 'unknown'];
  return h(
    'ul',
    { class: 'legend', 'data-node': 'truth-legend' },
    items.map((kind) =>
      h('li', { class: 'legend-item', 'data-truth': kind }, [
        h('span', { class: 'legend-swatch', 'aria-hidden': 'true' }),
        h('span', {}, [TRUTH_LABEL[kind]])
      ])
    )
  );
}
