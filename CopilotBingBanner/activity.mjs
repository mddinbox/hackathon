const ANSI_PATTERN =
  // CSI, OSC, and single-character terminal escape sequences.
  /[\u001b\u009b](?:\][^\u0007]*(?:\u0007|\u001b\\)|[\[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[-a-zA-Z\d/#&.:=?%@~_]+)*)?\u0007)|(?:(?:\d{1,4}(?:[;:]\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~])))/g;

const ACTIVE_LABELS = [
  "Thinking",
  "Working",
  "Analyzing",
  "Planning",
  "Searching",
  "Reading",
  "Writing",
  "Editing",
  "Running",
  "Building",
  "Testing",
  "Fetching",
];

const ACTIVE_PATTERN = new RegExp(`\\b(${ACTIVE_LABELS.join("|")})\\b`, "i");
const INPUT_PATTERN =
  /\b(?:allow this action|continue\?|do you want to|press enter|choose an option|select an option)\b|\[[yYnN]\/[yYnN]\]/i;
const READY_PATTERN = /what can i help with\??\s*$|(?:^|\n)\s*[❯>$]\s*$/i;

export function cleanTerminalText(value) {
  return value
    .replace(ANSI_PATTERN, "")
    .replace(/\r/g, "\n")
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "");
}

export class ActivityTracker {
  constructor(onChange, settleDelay = 1800) {
    this.onChange = onChange;
    this.settleDelay = settleDelay;
    this.active = false;
    this.pending = false;
    this.label = "Working";
    this.timer = undefined;
  }

  submitted() {
    this.pending = true;
    this.#publish(true, "Working");
  }

  observed(output) {
    if (!this.pending) {
      return;
    }

    const text = cleanTerminalText(output);
    if (INPUT_PATTERN.test(text) || READY_PATTERN.test(text)) {
      this.settled();
      return;
    }

    const activeMatch = text.match(ACTIVE_PATTERN);
    if (activeMatch) {
      const label =
        activeMatch[1][0].toUpperCase() + activeMatch[1].slice(1).toLowerCase();
      this.#publish(true, label);
    }

    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.settled(), this.settleDelay);
  }

  settled() {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = false;
    this.#publish(false, this.label);
  }

  dispose() {
    clearTimeout(this.timer);
  }

  #publish(active, label) {
    if (this.active === active && this.label === label) {
      return;
    }

    this.active = active;
    this.label = label;
    this.onChange({ active, label });
  }
}
