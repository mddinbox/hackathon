/**
 * Core 2 — the **Experience Synthesis Engine**.
 *
 * It consumes a `SituationGraph` and, optionally, a normalized presentation
 * blueprint, and decides what world that situation deserves: which outcome
 * template compiles, which visual forces are permitted to paint, which
 * handoffs exist, and how the questions the Situation Intelligence Engine
 * already selected are displayed.
 *
 * What it cannot do is the interesting half of the contract:
 *
 *   - it cannot fetch anything. There is no import of `fetch`, of the
 *     geolocation module, of the agent or blueprint gateways, or of
 *     `contextProviders` anywhere in this file, and a test asserts that by
 *     reading this source;
 *   - it cannot infer a fact. Everything it draws already exists in the graph
 *     with a truth kind and an authority attached;
 *   - it cannot ask a question. It renders the question plan; it never adds to
 *     it, and a presentation blueprint that arrives carrying questions cannot
 *     buy a human's attention through this engine;
 *   - it never accepts arbitrary HTML, CSS or JS. The only thing it hands the
 *     compiler is a schema-checked blueprint, and `templateCompiler.ts` stays
 *     the single safe visual compiler underneath it.
 */
import {
  newsBlueprint,
  pickupBlueprint,
  BLUEPRINT_VERSION,
  type BlueprintForce,
  type BlueprintHandoff,
  type TemplateBlueprint,
  type TemplateFamily
} from './templateBlueprint';
import { compileTemplate, describeTemplate, type CompiledTemplate, type CompileOptions } from './templateCompiler';
import type { SituationGraph, SituationQuestion } from '../situation-graph';

export type BlueprintSourceKind = 'fallback' | 'sol-generated';

export interface SynthesisDecision {
  id: string;
  outcome: 'derived' | 'accepted' | 'rejected' | 'downgraded';
  /** One line, in the user's language, for the Source sheet. */
  detail: string;
}

export interface ExperienceForce {
  id: string;
  type: BlueprintForce['type'];
  relevance: number;
  truth: BlueprintForce['truth'];
  /** Where the datum came from, carried straight through from the graph. */
  authority: string;
  freshness: string;
  anchor: string;
  materialEffect: string;
  origin: 'graph' | 'blueprint';
}

export interface QuestionDisplayEntry {
  id: string;
  prompt: string;
  reason: string;
  materialEffect: string;
  selected: boolean;
  verdict: string;
}

export interface QuestionDisplayContract {
  budget: number;
  asked: QuestionDisplayEntry[];
  refused: QuestionDisplayEntry[];
}

export interface ExperiencePlan {
  graphId: string;
  graphVersion: number;
  graphKind: SituationGraph['kind'];
  family: TemplateFamily;
  templateLabel: string;
  blueprintSource: BlueprintSourceKind;
  blueprint: TemplateBlueprint;
  compiled: CompiledTemplate;
  visualForces: ExperienceForce[];
  /** Claim-level lines the world stands on, straight from the graph. */
  evidence: string[];
  decisions: SynthesisDecision[];
  handoffs: BlueprintHandoff[];
  questionContract: QuestionDisplayContract;
}

export interface SynthesisInput {
  graph: SituationGraph;
  /** A Sol-generated blueprint, when one exists. Presentation only. */
  blueprint?: TemplateBlueprint | null;
  options?: CompileOptions;
}

/* ------------------------------------------------------- graph readings */

function hasOrigin(graph: SituationGraph): boolean {
  return graph.informationNeeds.some((need) => need.id === 'origin-location' && need.status === 'satisfied');
}

function isInternational(graph: SituationGraph): boolean {
  const fact = graph.facts.find((entry) => entry.id === 'arrival-kind');
  return fact ? fact.label === 'International arrival' : true;
}

function flightLabel(graph: SituationGraph): string {
  return graph.entities.find((entity) => entity.kind === 'flight')?.label ?? 'the inbound flight';
}

/**
 * The template family this graph deserves, decided from the graph alone.
 *
 * A pickup is a journey. A briefing is a field. Tracking is a reading, so it is
 * honestly literal. A connection is the **Coordination Constellation** — a
 * world this build can name and argue for but cannot yet assemble, so it
 * resolves literal and says so rather than pretending.
 */
export function expectedFamily(graph: SituationGraph): TemplateFamily {
  if (graph.kind === 'travel-arrival') {
    if (graph.chosenJob === 'track') return 'literal';
    if (graph.chosenJob === 'connect') return 'literal';
    return 'journey-world';
  }
  if (graph.kind === 'living-news') return 'signal-field';
  return 'literal';
}

/* ------------------------------------------------- deterministic fallback */

function literalTemplateFor(graph: SituationGraph): TemplateBlueprint['template'] {
  if (graph.chosenJob === 'connect') {
    return {
      family: 'literal',
      primaryAxis: 'people — who has to be where',
      secondaryAxis: 'time — the gap between two aircraft',
      worldMetaphor:
        'Coordination Constellation — the connection world this situation deserves, named honestly because this build cannot assemble it yet',
      visualForces: ['flight', 'gate', 'walk time']
    };
  }
  if (graph.kind === 'travel-arrival') {
    return {
      family: 'literal',
      primaryAxis: 'the arrival, as a reading',
      secondaryAxis: 'its citations',
      worldMetaphor: 'a reading, not a world — tracking an arrival is a sentence with sources under it',
      visualForces: ['flight']
    };
  }
  return {
    family: 'literal',
    primaryAxis: 'the answer',
    secondaryAxis: 'its citations',
    worldMetaphor: 'a sentence, because the question has no latent job behind it',
    visualForces: []
  };
}

function literalBlueprint(graph: SituationGraph): TemplateBlueprint {
  return {
    version: BLUEPRINT_VERSION,
    source: 'fallback',
    situation: {
      type: graph.kind,
      label: graph.decisionGoal.statement,
      entities: graph.entities.map((entity) => entity.label).slice(0, 8),
      localTime: graph.moment.localTime,
      place: graph.place.label
    },
    jobs: {
      primary: {
        id: graph.chosenJob ?? 'answer',
        label: graph.hypotheses[0]?.label ?? 'An answer',
        evidence: graph.hypotheses[0]?.evidence ?? []
      },
      alternates: graph.hypotheses.slice(1).map((hypothesis) => ({
        id: hypothesis.id,
        label: hypothesis.label,
        evidence: hypothesis.evidence
      }))
    },
    template: literalTemplateFor(graph),
    forces: [],
    unknowns: graph.unknowns.map((unknown) => ({
      id: unknown.id,
      reason: unknown.reason,
      resolvedBy: unknown.resolvedBy
    })),
    questions: [],
    handoffs: graph.handoffNeeds.map((handoff) => ({
      id: handoff.id,
      label: handoff.label,
      action: handoff.action,
      url: handoff.url
    })),
    refresh: { targetEvent: graph.refreshNeed.targetEvent, cadenceHint: graph.refreshNeed.cadenceHint }
  };
}

/**
 * The blueprint the product can always produce on its own, derived from the
 * graph rather than from the prompt. `pickupBlueprint` and `newsBlueprint`
 * remain the implementation of the two hero families — they are helpers of this
 * engine now, and nothing outside it imports them.
 */
export function fallbackBlueprint(graph: SituationGraph): TemplateBlueprint {
  const family = expectedFamily(graph);
  if (family === 'journey-world') {
    return pickupBlueprint({
      flightLabel: flightLabel(graph),
      chosenJob: (graph.chosenJob as 'track' | 'connect' | 'pickup' | null) ?? null,
      hasOrigin: hasOrigin(graph),
      international: isInternational(graph),
      localTime: graph.moment.localTime
    });
  }
  if (family === 'signal-field') {
    return newsBlueprint({
      label: graph.readings.news?.label ?? graph.decisionGoal.statement,
      place: graph.place.label,
      localTime: graph.moment.localTime
    });
  }
  return literalBlueprint(graph);
}

/* --------------------------------------------------- compatibility gate */

export interface CompatibilityVerdict {
  compatible: boolean;
  reason: string;
}

/**
 * Whether a proposed presentation blueprint may shape this graph's world.
 *
 * The test is the family: a blueprint that thinks a pickup is a signal field
 * has misread the situation, and no amount of nice prose in it changes that.
 * A compatible blueprint is allowed to adjust the safe presentation choices —
 * the axes, the metaphor, the force relevances, the handoffs — because those
 * are arguments about shape, not claims about facts.
 */
export function blueprintCompatibility(graph: SituationGraph, blueprint: TemplateBlueprint): CompatibilityVerdict {
  const expected = expectedFamily(graph);
  if (blueprint.template.family === expected) {
    return { compatible: true, reason: `it agrees this situation is a ${expected}` };
  }
  return {
    compatible: false,
    reason: `it proposed ${blueprint.template.family} for a situation the graph reads as ${expected}`
  };
}

/* ------------------------------------------------------------- synthesis */

function forcesFromGraph(graph: SituationGraph, blueprint: TemplateBlueprint): ExperienceForce[] {
  const byId = new Map(blueprint.forces.map((force) => [force.id, force]));
  const forces: ExperienceForce[] = graph.forces.map((force) => {
    const proposed = byId.get(force.id);
    return {
      id: force.id,
      type: force.type,
      // A blueprint may argue about how loud a force is; it cannot invent one,
      // and it cannot claim a truth kind the graph did not establish.
      relevance: proposed ? proposed.relevance : force.relevance,
      truth: force.truth,
      authority: force.authority,
      freshness: force.freshness,
      anchor: `${force.anchor.spatial} · ${force.anchor.temporal}`,
      materialEffect: force.materialEffect,
      origin: proposed ? 'blueprint' : 'graph'
    };
  });
  return forces.sort((a, b) => b.relevance - a.relevance);
}

function evidenceFromGraph(graph: SituationGraph): string[] {
  const lines: string[] = [];
  for (const fact of graph.facts) {
    lines.push(`${fact.label}: ${fact.statement} (${fact.truth} · ${fact.authority})`);
  }
  for (const unknown of graph.unknowns) {
    lines.push(`${unknown.label}: ${unknown.reason} → ${unknown.resolvedBy}`);
  }
  return lines;
}

function displayEntry(question: SituationQuestion, selected: boolean, verdict: string): QuestionDisplayEntry {
  return {
    id: question.id,
    prompt: question.prompt,
    reason: question.whyNeeded,
    materialEffect: question.materialEffect,
    selected,
    verdict
  };
}

function questionContract(graph: SituationGraph): QuestionDisplayContract {
  const asked = graph.questionPlan.asked.map((question) =>
    displayEntry(question, true, 'Asked after surviving question economics.')
  );
  const refused: QuestionDisplayEntry[] = [];
  for (const verdict of graph.questionPlan.verdicts) {
    if (graph.questionPlan.askedIds.includes(verdict.question.id)) continue;
    const entry = displayEntry(verdict.question, verdict.selected, verdict.verdict);
    if (!verdict.selected) refused.push(entry);
  }
  return { budget: graph.questionPlan.budget, asked, refused };
}

export class ExperienceSynthesisEngine {
  synthesize(input: SynthesisInput): ExperiencePlan {
    const { graph } = input;
    const decisions: SynthesisDecision[] = [];
    const expected = expectedFamily(graph);
    const fallback = fallbackBlueprint(graph);

    decisions.push({
      id: 'family',
      outcome: 'derived',
      detail: `The graph reads this as ${graph.kind}${
        graph.chosenJob ? ` with the job "${graph.chosenJob}"` : ' with no job chosen yet'
      }, so the deterministic world is ${expected}.`
    });

    let blueprint = fallback;
    let blueprintSource: BlueprintSourceKind = 'fallback';

    const proposed = input.blueprint ?? null;
    if (proposed) {
      const verdict = blueprintCompatibility(graph, proposed);
      if (verdict.compatible) {
        blueprint = proposed;
        blueprintSource = proposed.source === 'sol-generated' ? 'sol-generated' : 'fallback';
        decisions.push({
          id: 'blueprint',
          outcome: 'accepted',
          detail: `A generated blueprint was accepted for presentation only — ${verdict.reason}. It adjusted axes, metaphor and force emphasis; it established no fact.`
        });
      } else {
        decisions.push({
          id: 'blueprint',
          outcome: 'rejected',
          detail: `A generated blueprint was rejected and the deterministic world kept — ${verdict.reason}.`
        });
      }
    }

    if (proposed && proposed.questions.length > 0) {
      decisions.push({
        id: 'blueprint-questions',
        outcome: 'downgraded',
        detail:
          'The blueprint carried questions. Presentation cannot ask anything, so they were handed back to question economics as candidates rather than shown.'
      });
    }

    if (expected === 'literal' && graph.chosenJob === 'connect') {
      decisions.push({
        id: 'coordination-constellation',
        outcome: 'downgraded',
        detail:
          'A connection deserves the Coordination Constellation. This build cannot assemble that world, so it is named honestly and the literal answer is kept.'
      });
    }

    const compiled = compileTemplate(blueprint, input.options ?? {});

    return {
      graphId: graph.id,
      graphVersion: graph.version,
      graphKind: graph.kind,
      family: compiled.family,
      templateLabel: describeTemplate(compiled),
      blueprintSource,
      blueprint,
      compiled,
      visualForces: forcesFromGraph(graph, blueprint),
      evidence: evidenceFromGraph(graph),
      decisions,
      handoffs: blueprint.handoffs,
      questionContract: questionContract(graph)
    };
  }
}

export const experienceSynthesis = new ExperienceSynthesisEngine();

/** One line naming the world and where its blueprint came from. */
export function describeExperience(plan: ExperiencePlan): string {
  return `${plan.templateLabel} · blueprint: ${plan.blueprintSource === 'sol-generated' ? 'Sol-generated' : 'fallback'}`;
}
