/**
 * Appearance and accessibility preferences.
 *
 * These live behind the single "More" control. They are stored locally,
 * contain nothing about the user's situation or location, and never appear
 * as chrome in the consumer flow.
 */
export interface Appearance {
  contrast: 'standard' | 'high';
  motion: 'full' | 'reduced';
  textSize: 'standard' | 'large';
}

const STORAGE_KEY = 'canvasbrowser.appearance.v1';

export const DEFAULT_APPEARANCE: Appearance = {
  contrast: 'standard',
  motion: 'full',
  textSize: 'standard'
};

/**
 * `?motion=off` forces reduced motion for a session without touching stored
 * preferences. Deterministic surfaces are what automated checks need, and a
 * person who wants this permanently already has the control in More.
 */
function motionOverride(): 'reduced' | null {
  try {
    const value = new URLSearchParams(window.location.search).get('motion');
    return value === 'off' || value === 'reduced' || value === 'none' ? 'reduced' : null;
  } catch {
    return null;
  }
}

export function loadAppearance(): Appearance {
  const override = motionOverride();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_APPEARANCE, motion: override ?? DEFAULT_APPEARANCE.motion };
    const parsed = JSON.parse(raw) as Partial<Appearance>;
    return {
      contrast: parsed.contrast === 'high' ? 'high' : 'standard',
      motion: override ?? (parsed.motion === 'reduced' ? 'reduced' : 'full'),
      textSize: parsed.textSize === 'large' ? 'large' : 'standard'
    };
  } catch {
    return { ...DEFAULT_APPEARANCE, motion: override ?? DEFAULT_APPEARANCE.motion };
  }
}

export function saveAppearance(appearance: Appearance): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appearance));
  } catch {
    /* storage is optional */
  }
}

export function applyAppearance(appearance: Appearance): void {
  const root = document.documentElement;
  root.dataset.contrast = appearance.contrast;
  root.dataset.motion = appearance.motion;
  root.dataset.textSize = appearance.textSize;
}
