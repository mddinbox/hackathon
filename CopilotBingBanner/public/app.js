import {
  careForPet,
  defaultPetState,
  normalizePetState,
  petArt,
  petProgress,
  rewardPet,
} from "../pet.mjs";

const promotions = [
  {
    id: "surface-laptop",
    title: "Surface Laptop, Copilot+ PC",
    price: "From $999.99",
    merchant: "Microsoft Store",
    rating: "4.7",
    query: "Surface Laptop Copilot+ PC",
  },
  {
    id: "xbox-controller",
    title: "Xbox Wireless Controller",
    price: "From $49.99",
    merchant: "Compare retailers",
    rating: "4.8",
    query: "Xbox Wireless Controller deals",
  },
  {
    id: "coding-keyboards",
    title: "Mechanical Keyboards for Coding",
    price: "From $69.00",
    merchant: "Multiple stores",
    rating: "4.6",
    query: "mechanical keyboard for coding shopping",
  },
  {
    id: "developer-monitors",
    title: "Ultrawide Developer Monitors",
    price: "From $279.99",
    merchant: "Compare retailers",
    rating: "4.5",
    query: "ultrawide monitor deals",
  },
];

const terminalElement = document.querySelector("#terminal");
const promotionElement = document.querySelector("#promotion");
const promotionTitle = document.querySelector("#promotion-title");
const promotionLink = document.querySelector("#promotion-link");
const productPrice = document.querySelector("#product-price");
const productMerchant = document.querySelector("#product-merchant");
const productRating = document.querySelector("#product-rating");
const activityLabel = document.querySelector("#activity-label");
const connectionDot = document.querySelector("#connection-dot");
const connectionLabel = document.querySelector("#connection-label");
const reconnectButton = document.querySelector("#reconnect");
const dismissButton = document.querySelector("#dismiss-promotion");
const petPanel = document.querySelector("#pet-panel");
const terminalWorkbench = document.querySelector(".terminal-workbench");
const petExpanded = document.querySelector("#pet-expanded");
const petCollapsed = document.querySelector("#pet-collapsed");
const petCollapseButton = document.querySelector("#pet-collapse");
const petArtElement = document.querySelector("#pet-art");
const petName = document.querySelector("#pet-name");
const petStage = document.querySelector("#pet-stage");
const petProgressCopy = document.querySelector("#pet-progress-copy");
const petProgressFill = document.querySelector("#pet-progress-fill");
const petMood = document.querySelector("#pet-mood");
const petMessage = document.querySelector("#pet-message");
const petMiniArt = document.querySelector("#pet-mini-art");
const petMiniCopy = document.querySelector("#pet-mini-copy");
const petFeedButton = document.querySelector("#pet-feed");
const petPlayButton = document.querySelector("#pet-play");

const PET_STORAGE_KEY = "copilot-cli-bytepet-v1";
let petState = loadPet();
let localCommand = "";

const terminal = new Terminal({
  cursorBlink: true,
  cursorStyle: "bar",
  convertEol: true,
  fontFamily: '"Cascadia Code", "SFMono-Regular", Consolas, monospace',
  fontSize: 14,
  lineHeight: 1.35,
  letterSpacing: 0.2,
  theme: {
    background: "#090b10",
    foreground: "#dfe6f3",
    cursor: "#69efb2",
    cursorAccent: "#090b10",
    selectionBackground: "#245f4f99",
    black: "#090b10",
    brightBlack: "#667085",
    green: "#69efb2",
    brightGreen: "#96f7ca",
    cyan: "#6ee7f5",
    brightCyan: "#a5f3fc",
    white: "#dfe6f3",
    brightWhite: "#ffffff",
  },
});
const fitAddon = new FitAddon.FitAddon();
terminal.loadAddon(fitAddon);
terminal.open(terminalElement);

let socket;
let promotionIndex = 0;
let rotationTimer;
let promotionDismissed = false;

function connect() {
  fitAddon.fit();
  reconnectButton.hidden = true;
  setConnection("connecting", "Connecting");

  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  socket = new WebSocket(
    `${protocol}//${location.host}/terminal?cols=${terminal.cols}&rows=${terminal.rows}`,
  );

  socket.addEventListener("open", () => {
    setConnection("connected", "Copilot connected");
    terminal.focus();
  });

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.type === "output") {
      terminal.write(message.data);
    } else if (message.type === "activity") {
      setActivity(message.active, message.label);
    } else if (message.type === "error") {
      terminal.writeln(`\r\n\x1b[31m${message.message}\x1b[0m`);
    } else if (message.type === "exit") {
      terminal.writeln(`\r\n\x1b[90mCopilot exited with code ${message.exitCode}.\x1b[0m`);
    }
  });

  socket.addEventListener("close", () => {
    setActivity(false);
    setConnection("disconnected", "Session ended");
    reconnectButton.hidden = false;
  });

  socket.addEventListener("error", () => {
    setConnection("disconnected", "Connection failed");
  });
}

terminal.onData((data) => {
  if (handleLocalPetInput(data)) {
    return;
  }
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "input", data }));
  }
});

terminal.onResize(({ cols, rows }) => {
  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "resize", cols, rows }));
  }
});

const resizeObserver = new ResizeObserver(() => fitAddon.fit());
resizeObserver.observe(terminalElement);

function setActivity(active, label = "Working") {
  clearInterval(rotationTimer);
  rotationTimer = undefined;

  if (!active || promotionDismissed) {
    promotionElement.hidden = true;
    return;
  }

  activityLabel.textContent = `Copilot is ${label.toLowerCase()}...`;
  renderPromotion();
  promotionElement.hidden = false;
  rotationTimer = setInterval(() => {
    promotionIndex = (promotionIndex + 1) % promotions.length;
    renderPromotion();
  }, 9000);
}

function renderPromotion() {
  const promotion = promotions[promotionIndex];
  promotionTitle.textContent = promotion.title;
  productPrice.textContent = promotion.price;
  productMerchant.textContent = promotion.merchant;
  productRating.textContent = promotion.rating;
  promotionLink.href = `https://www.bing.com/search?q=${encodeURIComponent(promotion.query)}`;
}

function loadPet() {
  try {
    return normalizePetState(JSON.parse(localStorage.getItem(PET_STORAGE_KEY)));
  } catch {
    return defaultPetState();
  }
}

function savePet() {
  localStorage.setItem(PET_STORAGE_KEY, JSON.stringify(petState));
}

function renderPet(message = "") {
  const progress = petProgress(petState);
  const level = ["egg", "hatchling", "explorer", "builder", "guardian"].indexOf(
    progress.stage.id,
  );
  petPanel.dataset.stage = progress.stage.id;
  petPanel.dataset.ready =
    progress.stage.next !== null && progress.percent >= 80 ? "true" : "false";
  renderPetArt(petArt(progress.stage.id));
  petName.textContent = petState.name;
  petStage.textContent = `${progress.stage.label} · Level ${level}`;
  petProgressCopy.textContent =
    progress.required === null
      ? `${petState.sparks} · MAX`
      : `${progress.current} / ${progress.required}`;
  petProgressFill.style.width = `${progress.percent}%`;
  petMood.textContent = `Mood · ${petState.mood}`;
  petMessage.textContent = message || "Earn Sparks from optional rewarded offers.";
  petMiniArt.textContent = progress.stage.id === "egg" ? "🥚" : "✦";
  petMiniCopy.textContent = `${progress.stage.label} · ${petState.sparks} Sparks`;
  petPanel.hidden = !petState.visible;
  terminalWorkbench.classList.toggle("pet-hidden", !petState.visible);
  petExpanded.hidden = !petState.visible || petState.collapsed;
  petCollapsed.hidden = !petState.visible || !petState.collapsed;
  petCollapseButton.textContent = petState.collapsed ? "[ + ]" : "[ − ]";
  requestAnimationFrame(() => fitAddon.fit());
}

function renderPetArt(art) {
  const colorClasses = {
    "█": "pet-pixel-shell",
    "▄": "pet-pixel-shell",
    "▀": "pet-pixel-shell",
    "░": "pet-pixel-shadow",
    "▒": "pet-pixel-accent",
    "▓": "pet-pixel-core",
    "◉": "pet-pixel-face",
    "ᴗ": "pet-pixel-face",
    "✦": "pet-pixel-spark",
    "◆": "pet-pixel-spark",
    "⚒": "pet-pixel-spark",
  };
  const fragment = document.createDocumentFragment();
  for (const character of art) {
    const className = colorClasses[character];
    if (!className) {
      fragment.append(document.createTextNode(character));
      continue;
    }
    const pixel = document.createElement("span");
    pixel.className = className;
    pixel.textContent = character;
    fragment.append(pixel);
  }
  petArtElement.replaceChildren(fragment);
}

function updatePet(nextState, message) {
  petState = nextState;
  savePet();
  renderPet(message);
}

function handleLocalPetInput(data) {
  if (data === "\u007f") {
    localCommand = localCommand.slice(0, -1);
    return false;
  }
  if (/^[\x20-\x7e]+$/.test(data)) {
    localCommand += data;
    return false;
  }
  if (!/[\r\n]/.test(data)) {
    return false;
  }

  const command = localCommand.trim();
  localCommand = "";
  if (!command.startsWith("/pet")) {
    return false;
  }

  if (socket?.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify({ type: "input", data: "\u0015" }));
  }
  const [, action = "status", ...rest] = command.split(/\s+/);
  if (action === "hide" || action === "show") {
    updatePet(
      {
        ...petState,
        visible: action === "show",
        collapsed: false,
      },
      action === "hide" ? "BytePet returned to its secret habitat." : "A mysterious BytePet appeared!",
    );
  } else {
    const result = careForPet(petState, action, rest.join(" "));
    updatePet(result.state, result.message);
  }
  terminal.writeln(`\r\n\x1b[38;2;105;239;178mBYTEPET\x1b[0m ${petMessage.textContent}`);
  return true;
}

function setConnection(state, label) {
  connectionDot.dataset.state = state;
  connectionLabel.textContent = label;
}

dismissButton.addEventListener("click", () => {
  promotionDismissed = true;
  setActivity(false);
});

promotionLink.addEventListener("click", () => {
  const promotion = promotions[promotionIndex];
  const result = rewardPet(petState, promotion.id);
  if (result.awarded > 0) {
    const message = result.evolved
      ? `+${result.awarded} Sparks · ${petState.name} evolved!`
      : `+${result.awarded} demo Sparks from this offer.`;
    updatePet(result.state, message);
    if (!result.state.visible) {
      terminal.writeln(
        `\r\n\x1b[38;2;105;239;178m✦ You earned ${result.awarded} mysterious Sparks. Try /pet show\x1b[0m`,
      );
    }
  } else if (result.reason === "already-rewarded") {
    renderPet("This offer already rewarded Sparks today.");
  } else {
    renderPet("Daily demo reward limit reached.");
  }
});

petCollapseButton.addEventListener("click", () => {
  updatePet({ ...petState, collapsed: !petState.collapsed });
});
petCollapsed.addEventListener("click", () => {
  updatePet({ ...petState, collapsed: false }, "BytePet is ready.");
});
petFeedButton.addEventListener("click", () => {
  const result = careForPet(petState, "feed");
  updatePet(result.state, result.message);
});
petPlayButton.addEventListener("click", () => {
  const result = careForPet(petState, "play");
  updatePet(result.state, result.message);
});

reconnectButton.addEventListener("click", () => {
  promotionDismissed = false;
  terminal.clear();
  connect();
});

window.addEventListener("beforeunload", () => socket?.close());
window.addEventListener("storage", (event) => {
  if (event.key !== PET_STORAGE_KEY || !event.newValue) {
    return;
  }
  try {
    petState = normalizePetState(JSON.parse(event.newValue));
    renderPet("BytePet progress synchronized.");
  } catch (error) {
    console.error("Unable to synchronize BytePet state.", error);
  }
});
renderPet();
connect();
