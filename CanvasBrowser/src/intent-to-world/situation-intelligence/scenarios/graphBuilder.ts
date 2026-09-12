/**
 * Turns a recognized scenario into a `SituationGraph`, and picks which scenario
 * a prompt is.
 *
 * The graph it builds is `kind: 'literal'` so it renders on the existing literal
 * surface with no shell change, but it carries the scenario's identity
 * (`scenarioId`), its `resolutionMode`, its real provider needs, its decision
 * goal, its question economics and its honest "world it deserves" — none of
 * which a bare literal answer had. This is the generalization: the same literal
 * surface, backed by a genuinely understood situation.
 *
 * It imports the graph contract, the provider capability checks and question
 * economics — never the engine (`index.ts`) — so there is no import cycle.
 */
import {
  SITUATION_GRAPH_VERSION,
  type InformationNeed,
  type QuestionPlan,
  type SituationConstraint,
  type SituationGraph,
  type SituationQuestion,
  type SituationQuestionVerdict
} from '../../situation-graph';
import { providerAvailable, providerDescriptor, type ProviderCapabilities } from '../contextProviders';
import { MAX_SELECTED_QUESTIONS, selectQuestions } from '../questionEconomics';
import type {
  ScenarioBuildContext,
  ScenarioDefinition,
  ScenarioMatch,
  ScenarioNeedSpec,
  ScenarioQuestionSpec
} from './types';

let scenarioSeq = 0;

function scenarioGraphId(scenarioId: string, nowMs: number): string {
  scenarioSeq += 1;
  return `scenario-${scenarioId}-${nowMs.toString(36)}-${scenarioSeq}`;
}

function localTimeLabel(nowMs: number): string {
  return new Date(nowMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function timeZoneLabel(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

function needStatus(
  spec: ScenarioNeedSpec,
  caps: ProviderCapabilities
): InformationNeed['status'] {
  if (providerAvailable(spec.provider, caps)) return 'available';
  const descriptor = providerDescriptor(spec.provider);
  if (descriptor.requiresConsent) return 'needs-consent';
  return spec.optional ? 'planned' : 'unavailable';
}

function consentFor(spec: ScenarioNeedSpec, caps: ProviderCapabilities): InformationNeed['consent'] {
  const descriptor = providerDescriptor(spec.provider);
  if (!descriptor.requiresConsent) return 'not-required';
  return providerAvailable(spec.provider, caps) ? 'granted' : 'required';
}

function toNeed(spec: ScenarioNeedSpec, caps: ProviderCapabilities): InformationNeed {
  return {
    id: spec.id,
    purpose: spec.purpose,
    provider: spec.provider,
    fields: spec.fields,
    permission: spec.permission ?? null,
    consent: consentFor(spec, caps),
    priority: spec.priority,
    materialEffect: spec.materialEffect,
    status: needStatus(spec, caps),
    changesGraphBy: spec.changesGraphBy,
    optional: spec.optional ?? false
  };
}

/** The answer need every recognized scenario carries — the cited literal result. */
const ANSWER_NEED: ScenarioNeedSpec = {
  id: 'live-research',
  purpose: 'A cited answer to the question as asked.',
  provider: 'web-search',
  fields: ['answer', 'citations', 'retrieval time'],
  permission: null,
  priority: 0.95,
  materialEffect: 'It is the answer.',
  changesGraphBy: 'Produces the cited answer and its citations.',
  optional: false
};

function toSituationQuestion(spec: ScenarioQuestionSpec): SituationQuestion {
  return {
    id: spec.id,
    prompt: spec.prompt,
    whyNeeded: spec.whyNeeded,
    materialEffect: spec.materialEffect,
    expectedInformationGain: spec.expectedInformationGain,
    userCost: spec.userCost,
    choices: spec.choices.map((choice) => ({
      id: choice.id,
      label: choice.label,
      ...(choice.detail ? { detail: choice.detail } : {})
    })),
    origin: 'graph',
    satisfiesNeedId: spec.satisfiesNeedId ?? null,
    movesLevers: spec.movesLevers
  };
}

/**
 * A fresh question plan for a scenario. Mirrors the engine's `planQuestions`
 * fresh path (no questions asked yet at discovery), kept here so the builder
 * never imports the engine module.
 */
function planScenarioQuestions(candidates: SituationQuestion[]): QuestionPlan {
  const byId = new Map(candidates.map((question) => [question.id, question]));
  const result = selectQuestions(candidates, MAX_SELECTED_QUESTIONS);
  const verdicts: SituationQuestionVerdict[] = result.verdicts.map((verdict) => ({
    question: byId.get(verdict.question.id) ?? verdict.question,
    selected: verdict.selected,
    score: verdict.score,
    verdict: verdict.verdict,
    levers: verdict.levers
  }));
  return {
    budget: MAX_SELECTED_QUESTIONS,
    askedIds: [],
    asked: [],
    selected: verdicts.filter((verdict) => verdict.selected).map((verdict) => verdict.question),
    verdicts
  };
}

export function buildScenarioGraph(
  prompt: string,
  scenario: ScenarioDefinition,
  ctx: ScenarioBuildContext
): SituationGraph {
  const caps = ctx.capabilities;
  const scenarioNeeds = (scenario.needs?.(ctx) ?? []).map((spec) => toNeed(spec, caps));
  const informationNeeds: InformationNeed[] = [toNeed(ANSWER_NEED, caps), ...scenarioNeeds];

  const candidates = (scenario.questions?.(prompt, ctx) ?? []).map(toSituationQuestion);
  const questionPlan = planScenarioQuestions(candidates);

  // When the world a scenario deserves is one this build cannot assemble, the
  // graph says so out loud rather than dressing a literal answer up as that world.
  const constraints: SituationConstraint[] =
    scenario.deservedFamily === 'literal'
      ? []
      : [
          {
            id: 'deserved-world',
            label: 'The world this deserves',
            statement: scenario.deservedWorld,
            truth: 'observed',
            materialEffect:
              'Names the world this build does not assemble yet; the cited answer is rendered and the gap is stated.'
          }
        ];

  return {
    version: SITUATION_GRAPH_VERSION,
    id: scenarioGraphId(scenario.id, ctx.nowMs),
    prompt,
    kind: 'literal',
    scenarioId: scenario.id,
    resolutionMode: scenario.resolutionMode,
    moment: {
      nowMs: ctx.nowMs,
      localTime: localTimeLabel(ctx.nowMs),
      timeZone: timeZoneLabel(),
      truth: 'observed',
      authority: 'device'
    },
    place: {
      label: ctx.placeLabel ?? 'here',
      truth: 'inferred',
      authority: 'none',
      source: 'inferred'
    },
    entities: [],
    events: [],
    hypotheses: [
      {
        id: scenario.id,
        label: scenario.label,
        supported: true,
        evidence: [`recognized as ${scenario.label.toLowerCase()}`],
        confidence: 0.7
      }
    ],
    chosenJob: 'answer',
    facts: [],
    forces: [],
    constraints,
    unknowns: [],
    informationNeeds,
    questionPlan,
    refreshNeed:
      scenario.refresh ?? {
        targetEvent: 'nothing in particular',
        cadenceHint: 'never',
        whyItMatters: 'A sentence does not need watching.'
      },
    decisionGoal: {
      id: scenario.id,
      statement: scenario.decisionGoal.statement,
      successCriterion: scenario.decisionGoal.successCriterion,
      commitBlockedBy: null
    },
    handoffNeeds: scenario.handoffs?.(prompt) ?? [],
    readings: { arrival: null, news: null }
  };
}

const TIER_RANK: Record<ScenarioDefinition['demandTier'], number> = { A: 3, B: 2, C: 1 };

/**
 * Pick the scenario a prompt is, or null when none is confident.
 *
 * Highest detector confidence wins; ties break toward the higher demand tier,
 * then lexically by id, so classification is fully deterministic.
 */
export function classifyScenario(
  prompt: string,
  scenarios: readonly ScenarioDefinition[]
): ScenarioMatch | null {
  let best: ScenarioMatch | null = null;
  for (const scenario of scenarios) {
    const confidence = scenario.detect(prompt);
    if (confidence <= 0) continue;
    if (best === null) {
      best = { scenario, confidence };
      continue;
    }
    if (confidence > best.confidence) {
      best = { scenario, confidence };
      continue;
    }
    if (confidence === best.confidence) {
      const tie =
        TIER_RANK[scenario.demandTier] - TIER_RANK[best.scenario.demandTier] ||
        best.scenario.id.localeCompare(scenario.id);
      if (tie > 0) best = { scenario, confidence };
    }
  }
  return best;
}
