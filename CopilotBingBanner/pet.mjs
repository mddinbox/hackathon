export const PET_REWARD = 3;
export const DAILY_REWARD_LIMIT = 5;

export const PET_STAGES = [
  { id: "egg", label: "Egg", threshold: 0, next: 10 },
  { id: "hatchling", label: "Hatchling", threshold: 10, next: 25 },
  { id: "explorer", label: "Explorer", threshold: 25, next: 50 },
  { id: "builder", label: "Builder", threshold: 50, next: 100 },
  { id: "guardian", label: "Guardian", threshold: 100, next: null },
];

const PET_ART = {
  egg: buildEggOrb(),
  hatchling: [
    "     ▄█▄       ▄█▄",
    "    ████▄█████▄████",
    "    ███████████████",
    "    ███  ◉   ◉  ███",
    "    ███    ᴗ    ███",
    "     ███▄     ▄███",
    "       ▀███████▀",
    "       ▄██ █ ██▄",
    "      ▀▀   ▀   ▀▀",
  ].join("\n"),
  explorer: [
    "     ▄█▄       ▄█▄",
    "    ████▄█████▄████ ▄▓▄",
    "    ███  ◉   ◉  ███▓▓▓█",
    "    ███    ᴗ    ███▓▓▓█",
    "     ███▄     ▄███ ▀▓▀",
    "     ▄████◆████▄",
    "    ██▀ ██ ██ ▀██",
    "        ██ ██",
    "       ▀▀   ▀▀",
  ].join("\n"),
  builder: [
    "     ▄█▄       ▄█▄",
    "    ████▄█████▄████  ⚒",
    "    ███  ◉   ◉  ███▄█",
    "    ███    ᴗ    ███",
    "     ███▄     ▄███",
    "    ▄██▓▓▓◆▓▓▓██▄",
    "    ██▓ ▓▓▓▓▓ ▓██",
    "     ▀█▄██ ██▄█▀",
    "        ▀▀ ▀▀",
  ].join("\n"),
  guardian: [
    "  ✦  ▄█▄       ▄█▄  ✦",
    "   ▄████▄█████▄████▄",
    "  ◆████  ◉   ◉  ████◆",
    "   ▀███    ᴗ    ███▀",
    "     ███▄  ✦  ▄███",
    "    ▄██▓▓▓◆▓▓▓██▄",
    "   ◆██▓▓▓▓▓▓▓▓▓██◆",
    "     ▀██▄███▄██▀",
    "        ▀▀ ▀▀",
  ].join("\n"),
};

function buildEggOrb() {
  const outerWidths = [9, 17, 21, 23, 25, 27, 27, 27, 25, 23, 21, 17, 9];
  const cores = [
    "",
    "",
    "",
    "░▒▓▒░",
    "░▒▓▓▓▓▓▒░",
    "░▒▓▓▓▓▓▓▓▒░",
    "░▒▓▓▓▓▓▓▓▒░",
    "░▒▓▓▓▓▓▓▓▒░",
    "░▒▓▓▓▓▓▒░",
    "░▒▓▒░",
    "",
    "",
    "",
  ];
  return outerWidths
    .map((width, index) => {
      const core = cores[index];
      if (!core) {
        return "█".repeat(width);
      }
      const shellWidth = (width - [...core].length) / 2;
      return `${"█".repeat(shellWidth)}${core}${"█".repeat(shellWidth)}`;
    })
    .join("\n");
}

export function defaultPetState(today = isoDate()) {
  return {
    name: "Byte",
    sparks: 0,
    mood: "Curious",
    rewardDate: today,
    rewardedOffers: [],
    visible: false,
    collapsed: false,
  };
}

export function normalizePetState(value, today = isoDate()) {
  const fallback = defaultPetState(today);
  if (!value || typeof value !== "object") {
    return fallback;
  }

  const sameDay = value.rewardDate === today;
  return {
    name:
      typeof value.name === "string" && value.name.trim()
        ? value.name.trim().slice(0, 16)
        : fallback.name,
    sparks: Math.max(0, Math.floor(Number(value.sparks) || 0)),
    mood: typeof value.mood === "string" ? value.mood : fallback.mood,
    rewardDate: today,
    rewardedOffers:
      sameDay && Array.isArray(value.rewardedOffers)
        ? value.rewardedOffers.filter((item) => typeof item === "string").slice(0, DAILY_REWARD_LIMIT)
        : [],
    visible: Boolean(value.visible),
    collapsed: Boolean(value.collapsed),
  };
}

export function petStage(sparks) {
  return PET_STAGES.findLast((stage) => sparks >= stage.threshold);
}

export function petProgress(state) {
  const stage = petStage(state.sparks);
  if (stage.next === null) {
    return { stage, current: state.sparks - stage.threshold, required: null, percent: 100 };
  }

  const current = state.sparks - stage.threshold;
  const required = stage.next - stage.threshold;
  return {
    stage,
    current,
    required,
    percent: Math.min(100, Math.round((current / required) * 100)),
  };
}

export function rewardPet(state, offerId, today = isoDate()) {
  const current = normalizePetState(state, today);
  if (current.rewardedOffers.includes(offerId)) {
    return { state: current, awarded: 0, reason: "already-rewarded", evolved: false };
  }
  if (current.rewardedOffers.length >= DAILY_REWARD_LIMIT) {
    return { state: current, awarded: 0, reason: "daily-limit", evolved: false };
  }

  const previousStage = petStage(current.sparks).id;
  const next = {
    ...current,
    sparks: current.sparks + PET_REWARD,
    mood: "Excited",
    rewardedOffers: [...current.rewardedOffers, offerId],
  };
  return {
    state: next,
    awarded: PET_REWARD,
    reason: "rewarded",
    evolved: petStage(next.sparks).id !== previousStage,
  };
}

export function careForPet(state, action, value) {
  const current = normalizePetState(state);
  if (action === "name") {
    const name = String(value ?? "").trim().slice(0, 16);
    return {
      state: name ? { ...current, name } : current,
      message: name ? `Your BytePet is now named ${name}.` : "Choose a name after /pet name.",
    };
  }
  if (action === "feed" || action === "play") {
    if (current.sparks < 2) {
      return { state: current, message: `${current.name} needs 2 Sparks for that.` };
    }
    return {
      state: {
        ...current,
        sparks: current.sparks - 2,
        mood: action === "feed" ? "Content" : "Playful",
      },
      message:
        action === "feed"
          ? `${current.name} enjoyed a byte-cookie.`
          : `${current.name} chased a blinking cursor.`,
    };
  }
  return { state: current, message: `${current.name} is ${current.mood.toLowerCase()}.` };
}

export function petArt(stageId) {
  return centerArt(PET_ART[stageId] ?? PET_ART.egg);
}

function centerArt(art) {
  const lines = art.split("\n").map((line) => line.trim());
  const width = Math.max(...lines.map((line) => [...line].length));
  return lines
    .map((line) => {
      const remaining = width - [...line].length;
      const left = Math.floor(remaining / 2);
      const right = remaining - left;
      return `${" ".repeat(left)}${line}${" ".repeat(right)}`;
    })
    .join("\n");
}

function isoDate() {
  return new Date().toISOString().slice(0, 10);
}
