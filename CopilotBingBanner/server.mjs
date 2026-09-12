import { createServer } from "node:http";
import { access, constants, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import pty from "node-pty";
import { WebSocket, WebSocketServer } from "ws";
import { ActivityTracker } from "./activity.mjs";

const rootDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.join(rootDirectory, "public");
const port = Number.parseInt(process.env.PORT ?? "8787", 10);
const host = process.env.HOST ?? "127.0.0.1";
const requestedWorkingDirectory =
  process.env.COPILOT_WORKING_DIRECTORY ?? process.cwd();
const workingDirectory = path.resolve(requestedWorkingDirectory);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid PORT value: ${process.env.PORT}`);
}

await access(workingDirectory, constants.R_OK);
if (!(await stat(workingDirectory)).isDirectory()) {
  throw new Error(`COPILOT_WORKING_DIRECTORY is not a directory: ${workingDirectory}`);
}

const app = express();
app.disable("x-powered-by");
app.use(express.static(publicDirectory));
app.get("/pet.mjs", (_request, response) => {
  response.sendFile(path.join(rootDirectory, "pet.mjs"));
});
app.use(
  "/vendor/xterm",
  express.static(path.join(rootDirectory, "node_modules", "@xterm", "xterm")),
);
app.use(
  "/vendor/xterm-addon-fit",
  express.static(path.join(rootDirectory, "node_modules", "@xterm", "addon-fit")),
);

const server = createServer(app);
const sockets = new WebSocketServer({ noServer: true });

server.on("upgrade", (request, socket, head) => {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host}`);
  if (requestUrl.pathname !== "/terminal") {
    socket.destroy();
    return;
  }

  sockets.handleUpgrade(request, socket, head, (webSocket) => {
    sockets.emit("connection", webSocket, request);
  });
});

sockets.on("connection", (socket, request) => {
  const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host}`);
  const cols = clampDimension(requestUrl.searchParams.get("cols"), 80, 20, 300);
  const rows = clampDimension(requestUrl.searchParams.get("rows"), 24, 5, 120);
  let terminal;

  const send = (message) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  };

  const activity = new ActivityTracker((state) => {
    send({ type: "activity", ...state });
  });

  try {
    terminal = pty.spawn("copilot", [], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: workingDirectory,
      env: {
        ...process.env,
        TERM: "xterm-256color",
        COLORTERM: "truecolor",
      },
    });
  } catch (error) {
    send({
      type: "error",
      message:
        error instanceof Error
          ? `Unable to launch Copilot CLI: ${error.message}`
          : "Unable to launch Copilot CLI.",
    });
    socket.close(1011, "Copilot CLI failed to launch");
    activity.dispose();
    return;
  }

  terminal.onData((data) => {
    send({ type: "output", data });
    activity.observed(data);
  });

  terminal.onExit(({ exitCode }) => {
    activity.settled();
    send({ type: "exit", exitCode });
    socket.close(1000, "Copilot CLI exited");
  });

  socket.on("message", (rawMessage) => {
    let message;
    try {
      message = JSON.parse(rawMessage.toString());
    } catch {
      send({ type: "error", message: "Received an invalid terminal message." });
      return;
    }

    if (message.type === "input" && typeof message.data === "string") {
      terminal.write(message.data);
      if (/[\r\n]/.test(message.data)) {
        activity.submitted();
      }
      return;
    }

    if (message.type === "resize") {
      const nextCols = clampDimension(message.cols, cols, 20, 300);
      const nextRows = clampDimension(message.rows, rows, 5, 120);
      terminal.resize(nextCols, nextRows);
    }
  });

  socket.on("close", () => {
    activity.dispose();
    terminal.kill();
  });

  socket.on("error", () => {
    activity.dispose();
    terminal.kill();
  });
});

server.listen(port, host, () => {
  console.log(`Copilot + Bing Banner is running at http://${host}:${port}`);
  console.log(`Copilot working directory: ${workingDirectory}`);
});

function clampDimension(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback;
}
