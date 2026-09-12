/**
 * Human-attention economics, owned by Situation Intelligence.
 *
 * A question spends the single most expensive resource this product touches —
 * the person's attention — so it is treated the way decision theory treats any
 * costly observation: as an investment that only pays off when the answer can
 * actually change what happens.
 *
 * Two real-world results shape the model:
 *
 *   - **Value of Information** (Ronald A. Howard, "Information Value Theory",
 *     IEEE Trans. Systems Science & Cybernetics, 1966). An observation is worth
 *     acquiring only up to the value of the *decision it could change*. A
 *     question whose answer moves no decision has zero value however
 *     interesting it is, and it is worth more the more consequential the
 *     decision it can swing. Here the "decisions" are the four material levers a
 *     world is built from — the template, the route, the leave-by envelope and
 *     the handoff — and the template is the most consequential of them, because
 *     choosing it re-derives every other lever.
 *
 *   - **The Hick–Hyman law** (Hick 1952; Hyman 1953). Choice-reaction time rises
 *     with the entropy of the option set, i.e. roughly with log2(n). Attention
 *     cost is therefore carried explicitly on each candidate as `userCost` and
 *     subtracted, rather than assumed to be free.
 *
 * The result is deliberately conservative: at most two questions ever survive,
 * every candidate carries an argument for why it did or did not, and a question
 * that cannot name what it would change is dropped before cost is even weighed.
 */
import type { Lever } from '../situation-graph';

export const MAX_SELECTED_QUESTIONS = 2;

export interface QuestionCandidate {
  id: string;
  prompt: string;
  whyNeeded: string;
  materialEffect: string;
  expectedInformationGain: number;
  userCost: number;
  choices: Array<{ id: string; label: string; detail?: string }>;
  /**
   * An explicit declaration of which decision levers answering this would move.
   * Scenario-registry questions set this directly, so ranking no longer depends
   * on the pickup-world's four lever words appearing in the prose. When absent,
   * the levers are inferred from `materialEffect` exactly as before.
   */
  movesLevers?: readonly Lever[];
}

export const MATERIAL_LEVERS = ['template', 'route', 'envelope', 'handoff'] as const;

export type MaterialLever = (typeof MATERIAL_LEVERS)[number];

/**
 * The generalized decision levers a scenario question can declare it moves.
 *
 * The four pickup-world levers were prose-inferred, which does not survive
 * generalization: a "which city", "which date", "which ticker", "which unit"
 * or "how urgent" question moves a real decision but contains none of the four
 * words. Scenario questions therefore declare their levers from this vocabulary
 * instead of hoping the right word appears in their effect text.
 */
export const GENERALIZED_LEVERS = [
  'outcome-template',
  'scope',
  'place',
  'time-window',
  'entity-identity',
  'route',
  'handoff'
] as const;

export type { Lever };

const LEVER_WORDS: Record<MaterialLever, RegExp> = {
  template: /\btemplate|\bworld\b|which world|geometry/i,
  route: /\broute|\bdrive|\btraffic|\bcorridor|\bleave[- ]by|\bstops?\b|\bstaging\b/i,
  envelope: /\benvelope|\bwindow\b|\bleave time|\bcurb[- ]ready|\btiming\b/i,
  handoff: /\bhandoff|\blink\b|\bdirections\b|\bwho to text|\bpickup point/i
};

/**
 * How consequential each lever is, taken from the architecture rather than from
 * taste.
 *
 * The template is worth the most because it is upstream of everything: choosing
 * it re-derives the route, the envelope and the handoff. Scope and place decide
 * which world is assembled and where it is centred; the route, the leave-by
 * envelope and the time window shape the plan; the entity identity picks which
 * ticker/flight/product the world is about; the handoff is the terminal action.
 * These weights only order questions that value of information leaves tied —
 * they never override it.
 */
export const LEVER_IMPORTANCE: Record<Lever, number> = {
  template: 1,
  'outcome-template': 1,
  scope: 0.8,
  place: 0.75,
  route: 0.7,
  envelope: 0.7,
  'time-window': 0.7,
  'entity-identity': 0.65,
  handoff: 0.45
};

/**
 * How much a near-tie may be broken by lever importance.
 *
 * Bounded on purpose. Because importance is in [0, 1], the nudge it adds is at
 * most this value, so two questions whose raw value of information differs by
 * more than `IMPORTANCE_TIEBREAK` can never be reordered by importance. Value of
 * information always dominates; importance only settles genuine near-ties.
 */
export const IMPORTANCE_TIEBREAK = 0.05;

export interface QuestionVerdict<T extends QuestionCandidate = QuestionCandidate> {
  question: T;
  selected: boolean;
  score: number;
  verdict: string;
  levers: string[];
}

export interface SelectQuestionsResult<T extends QuestionCandidate = QuestionCandidate> {
  selected: T[];
  verdicts: Array<QuestionVerdict<T>>;
}

/**
 * Which levers a question moves — declared when the candidate says so, inferred
 * from the effect prose otherwise. Prose inference is unchanged: it only ever
 * returns the four original pickup-world levers, so existing behaviour is byte
 * for byte the same when nothing is declared.
 */
export function leversMoved(materialEffect: string, declared?: readonly Lever[]): Lever[] {
  if (declared && declared.length > 0) return [...declared];
  return MATERIAL_LEVERS.filter((lever) => LEVER_WORDS[lever].test(materialEffect));
}

/**
 * How decisive the levers a question moves are, in [0, 1].
 *
 * A question is as decisive as the single most consequential lever it can swing
 * (Howard: the value is the value of the decision it changes). Breadth — moving
 * more than one lever — is handled as a strictly lower-priority tie-break in the
 * ranking, not folded in here, so weight spacing can never let a broad-but-shallow
 * question outrank a decisive one.
 */
export function leverImportance(levers: readonly Lever[]): number {
  if (levers.length === 0) return 0;
  return Math.max(...levers.map((lever) => LEVER_IMPORTANCE[lever]));
}

/**
 * The raw value of information: what the answer buys minus what it costs to ask.
 * Rounded to two places so the number shown in the Source sheet is the number
 * the ranking used. This is the gate value — a question worth zero or less is
 * never asked — and the primary sort key.
 */
export function rawInformationValue(question: QuestionCandidate): number {
  return Math.round((question.expectedInformationGain - question.userCost) * 100) / 100;
}

/**
 * The expected value of information used to rank questions.
 *
 * Raw value dominates; lever importance only settles near-ties within
 * `IMPORTANCE_TIEBREAK`. Because that bound is smaller than every gap in
 * `LEVER_IMPORTANCE`, this can reorder two genuinely close questions but can
 * never overturn a clear difference in value.
 */
export function expectedValueOfInformation(question: QuestionCandidate): number {
  const raw = rawInformationValue(question);
  const importance = leverImportance(leversMoved(question.materialEffect, question.movesLevers));
  return raw + IMPORTANCE_TIEBREAK * importance;
}

export function selectQuestions<T extends QuestionCandidate>(
  questions: T[],
  limit: number = MAX_SELECTED_QUESTIONS
): SelectQuestionsResult<T> {
  const verdicts: Array<QuestionVerdict<T>> = [];
  const seenIds = new Set<string>();
  const seenPrompts = new Set<string>();
  const eligible: Array<QuestionVerdict<T> & { rank: number; importance: number }> = [];

  for (const question of questions) {
    const score = rawInformationValue(question);
    const levers = leversMoved(question.materialEffect, question.movesLevers);
    const importance = leverImportance(levers);
    const promptKey = question.prompt.toLowerCase();
    const reject = (verdict: string): void => {
      verdicts.push({ question, selected: false, score, verdict, levers });
    };

    if (seenIds.has(question.id) || seenPrompts.has(promptKey)) {
      reject('dropped — the same thing is already being asked');
      continue;
    }
    seenIds.add(question.id);
    seenPrompts.add(promptKey);

    if (!question.materialEffect) {
      reject('dropped — it never said what answering it would change');
      continue;
    }
    if (levers.length === 0) {
      reject('dropped — the stated effect moves no template, route, envelope or handoff');
      continue;
    }
    if (question.choices.length === 0) {
      reject('dropped — it offered nothing to answer with');
      continue;
    }
    if (score <= 0) {
      reject('dropped — it costs the person more attention than it buys');
      continue;
    }

    const entry: QuestionVerdict<T> & { rank: number; importance: number } = {
      question,
      selected: false,
      score,
      verdict: `kept — moves ${levers.join(' + ')}`,
      levers,
      rank: score + IMPORTANCE_TIEBREAK * importance,
      importance
    };
    eligible.push(entry);
    verdicts.push(entry);
  }

  // Value of information first; lever importance settles near-ties; breadth
  // (more levers moved) settles those; id keeps it deterministic at the end.
  eligible.sort(
    (a, b) =>
      b.rank - a.rank ||
      b.importance - a.importance ||
      b.levers.length - a.levers.length ||
      a.question.id.localeCompare(b.question.id)
  );
  const selected = eligible.slice(0, Math.max(0, Math.min(limit, MAX_SELECTED_QUESTIONS)));
  for (const entry of selected) entry.selected = true;
  for (const entry of eligible.slice(selected.length)) {
    entry.verdict = 'dropped — the two-question budget was already spent on higher-value questions';
  }

  return { selected: selected.map((entry) => entry.question), verdicts };
}
