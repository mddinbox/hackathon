/**
 * The visual compiler.
 *
 * A blueprint says *what kind of world* a situation deserves. This file is the
 * only thing allowed to turn that into pixels, and it does so by choosing from
 * primitives that already exist in the codebase: a template id, a geometry
 * balance, which map layers are drawn, which GPU mode is mounted, and the
 * sentences of the motion legend.
 *
 * The model never reaches the DOM. It cannot emit a class, a selector, a
 * style, an element or a script — the blueprint has no field that could carry
 * one, and every string in it has already been scrubbed. What it *can* do is
 * argue that a pickup is a journey and a briefing is a field, and this file
 * takes that argument seriously.
 *
 * Same grammar, different worlds: `journey-world` composes a spatial route
 * plane with a compressed time strip; `signal-field` composes reach rings.
 * Both come out of the same five blueprint fields.
 */
import type { BlueprintForce, ForceType, TemplateBlueprint, TemplateFamily } from './templateBlueprint';
import type { FxMode } from '../../visualEngine';

export type GeometryPlane = 'map' | 'field' | 'timeline' | 'prose';

export interface CompiledLayers {
  traffic: boolean;
  weather: boolean;
  airport: boolean;
  disruption: boolean;
}

export interface CompiledTemplate {
  family: TemplateFamily;
  /** Which surface renders this world. */
  view: 'journey' | 'field' | 'terrain' | 'literal';
  /** The dominant plane, and the linked one under it. */
  primary: GeometryPlane;
  secondary: GeometryPlane | null;
  /** 0–1 share of the stage the dominant plane takes. */
  primaryWeight: number;
  fxMode: FxMode | null;
  layers: CompiledLayers;
  /**
   * The motion vocabulary this template is *permitted* to use — one line each,
   * naming the datum that would drive it. It is a ceiling, not a promise: what
   * the world actually animates at any moment is decided by `motion.ts` from
   * live readings, and the legend under the map lists only that.
   */
  motionSemantics: string[];
  axisLabels: { primary: string; secondary: string };
  worldMetaphor: string;
  /** Forces sorted by relevance, so the map draws the loud ones last. */
  forces: BlueprintForce[];
}

const FAMILY_VIEW: Record<TemplateFamily, CompiledTemplate['view']> = {
  'journey-world': 'journey',
  'signal-field': 'field',
  'time-terrain': 'terrain',
  literal: 'literal'
};

const FAMILY_FX: Record<TemplateFamily, FxMode | null> = {
  'journey-world': 'journey',
  'signal-field': 'news',
  'time-terrain': 'travel',
  literal: null
};

const FAMILY_GEOMETRY: Record<TemplateFamily, { primary: GeometryPlane; secondary: GeometryPlane | null; weight: number }> = {
  // A pickup is a *time and space* problem, so the world is both: the route
  // plane dominates, and the arrival-processing terrain is a linked strip
  // under it rather than a second screen.
  'journey-world': { primary: 'map', secondary: 'timeline', weight: 0.62 },
  'signal-field': { primary: 'field', secondary: null, weight: 1 },
  'time-terrain': { primary: 'timeline', secondary: null, weight: 1 },
  literal: { primary: 'prose', secondary: null, weight: 1 }
};

/** Which map layer a force type is allowed to switch on. */
const FORCE_LAYER: Partial<Record<ForceType, keyof CompiledLayers>> = {
  traffic: 'traffic',
  weather: 'weather',
  airport: 'airport',
  disruption: 'disruption'
};

/**
 * The motion vocabulary. A blueprint force can only turn one of these on; it
 * cannot invent a new one, and it certainly cannot describe an animation in
 * its own words and have that executed.
 */
const MOTION_CLAUSES: Partial<Record<ForceType, string>> = {
  flight: 'the arrival pulse position reflects flight phase',
  traffic: 'route current density reflects sample traffic load',
  weather: 'the airport field deforms with sample wind and rain',
  disruption: 'incident markers pulse where the corridor is blocked',
  airport: 'curb and lot markers brighten as the curb window opens',
  market: 'axis currents run to the market axis'
};

export interface CompileOptions {
  /** Force the linked plane to become the dominant one (the Timeline lens). */
  lens?: 'journey' | 'timeline';
  /** False before an origin exists: the map still renders, as a stated gap. */
  hasSpatialAnchor?: boolean;
}

export function compileTemplate(blueprint: TemplateBlueprint, options: CompileOptions = {}): CompiledTemplate {
  const family = blueprint.template.family;
  const geometry = FAMILY_GEOMETRY[family];
  const forces = [...blueprint.forces].sort((a, b) => b.relevance - a.relevance);

  const layers: CompiledLayers = { traffic: false, weather: false, airport: false, disruption: false };
  const motionSemantics: string[] = ['scan cadence reflects refresh urgency'];

  for (const force of forces) {
    const layer = FORCE_LAYER[force.type];
    // Relevance is a threshold, not decoration: a force the blueprint thinks
    // barely matters does not get to paint over the route.
    if (layer && force.relevance >= 0.25) layers[layer] = true;
    const clause = MOTION_CLAUSES[force.type];
    if (clause && !motionSemantics.includes(clause)) motionSemantics.unshift(clause);
  }

  const timelineLens = options.lens === 'timeline' && geometry.secondary === 'timeline';
  const primary = timelineLens ? geometry.secondary! : geometry.primary;
  const secondary = timelineLens ? geometry.primary : geometry.secondary;

  return {
    family,
    view: FAMILY_VIEW[family],
    primary,
    secondary,
    primaryWeight: timelineLens ? 0.72 : options.hasSpatialAnchor === false ? 0.5 : geometry.weight,
    fxMode: timelineLens ? 'travel' : FAMILY_FX[family],
    layers,
    motionSemantics,
    axisLabels: { primary: blueprint.template.primaryAxis, secondary: blueprint.template.secondaryAxis },
    worldMetaphor: blueprint.template.worldMetaphor,
    forces
  };
}

/** `Journey World · map over a linked time strip` — one honest caption. */
export function describeTemplate(compiled: CompiledTemplate): string {
  const name =
    compiled.family === 'journey-world'
      ? 'Journey World'
      : compiled.family === 'signal-field'
        ? 'Signal Field'
        : compiled.family === 'time-terrain'
          ? 'Time Terrain'
          : 'Literal answer';
  const shape =
    compiled.secondary === null
      ? `${compiled.primary} only`
      : `${compiled.primary} over a linked ${compiled.secondary}`;
  return `${name} · ${shape}`;
}
