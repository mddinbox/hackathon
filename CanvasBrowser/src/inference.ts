/**
 * The inference budget.
 *
 * CanvasBrowser is allowed to ask for what it genuinely cannot infer, and
 * nothing more. The hard rule enforced here — and it is a product rule, not a
 * style preference — is that **no more than two clarifying questions** may be
 * asked before a template resolves or the answer falls back to the literal
 * one. Categories are never requested in a form; the world is reshaped after
 * it exists.
 *
 * Every question surface in the app goes through `askQuestion()`, so the
 * budget is a single, testable invariant rather than a convention.
 */

export const MAX_CLARIFYING_QUESTIONS = 2;

export interface ClarifyOption {
  id: string;
  label: string;
  /** One short line under the choice. Never a paragraph, never a form field. */
  detail?: string;
}

export interface ClarifyQuestion {
  id: string;
  /** Asked in the user's language, at display scale. */
  question: string;
  /**
   * One concise line stating why this is worth asking. Required in spirit for
   * every question the product shows: a question that cannot say what it
   * changes should not have been asked, and the surface renders this line so
   * the claim is visible rather than assumed.
   */
  reason?: string;
  options: ClarifyOption[];
  /** What happens if the budget runs out before this question is asked. */
  fallbackOptionId: string;
}

export interface InferenceState {
  questionsAsked: number;
  /** Question ids already spent, so the same thing is never asked twice. */
  asked: string[];
}

export function createInference(): InferenceState {
  return { questionsAsked: 0, asked: [] };
}

export function questionsRemaining(state: InferenceState): number {
  return Math.max(0, MAX_CLARIFYING_QUESTIONS - state.questionsAsked);
}

export function canAskQuestion(state: InferenceState): boolean {
  return questionsRemaining(state) > 0;
}

/**
 * Spends one unit of budget on a question.
 *
 * Returns the question when it may be asked, or `null` when the budget is
 * gone — in which case the caller must resolve with its own inference and
 * let the user reshape the result afterwards.
 */
export function askQuestion(state: InferenceState, question: ClarifyQuestion): ClarifyQuestion | null {
  if (state.asked.includes(question.id)) return null;
  if (!canAskQuestion(state)) return null;
  state.questionsAsked += 1;
  state.asked.push(question.id);
  return question;
}

/**
 * Templates are outcome-specific visual grammars. The resolver names which
 * geometry an outcome has — it is not a theme switch.
 *
 * - `time-terrain`  the answer is *when*: time-width geometry.
 * - `signal-field`  the answer is *what reaches me*: reach/proximity/impact geometry.
 * - `literal`       the answer is a sentence; no world is assembled.
 */
export type TemplateId = 'time-terrain' | 'signal-field' | 'literal';
