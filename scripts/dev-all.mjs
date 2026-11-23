/**
 * Start Vite (5173) + Python API (8787). Repo root: npm run dev:all
 */
import { execSync, spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const API_PORT = Number(process.env.PORT || 8787);
const WEB_PORT = Number(process.env.VITE_DEV_PORT || 5173);
const API_HOST = "127.0.0.1";
const HEALTH_URL = `http://${API_HOST}:${API_PORT}/api/health`;
const MAX_WAIT_MS = 120_000;

function portFree(port, host = "127.0.0.1") {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", () => resolve(false));
    srv.once("listening", () => {
      srv.close(() => resolve(true));
    });
    srv.listen(port, host);
  });
}

/** Vite binds 0.0.0.0 — checking only 127.0.0.1 can falsely report the port as free. */
async function webDevPortFree(port) {
  if (!(await portFree(port, "0.0.0.0"))) return false;
  return portFree(port, "127.0.0.1");
}

function windowsListenerPids(port) {
  if (process.platform !== "win32") return [];
  try {
    const out = execSync(`netstat -ano | findstr ":${port}" | findstr LISTENING`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const pids = new Set();
    for (const line of out.split(/\r?\n/)) {
      const m = line.trim().match(/\s+(\d+)\s*$/);
      if (m) pids.add(Number(m[1]));
    }
    return [...pids];
  } catch {
    return [];
  }
}

function tryReleasePort(port) {
  const pids = windowsListenerPids(port);
  if (!pids.length) return false;
  let killed = false;
  for (const pid of pids) {
    if (pid === process.pid) continue;
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
      console.warn(`[dev] Stopped stale process ${pid} that was using port ${port}.`);
      killed = true;
    } catch {
      console.warn(`[dev] Could not stop PID ${pid} on port ${port} — close it manually.`);
    }
  }
  return killed;
}

async function waitForHealth() {
  const start = Date.now();
  while (Date.now() - start < MAX_WAIT_MS) {
    try {
      const res = await fetch(HEALTH_URL, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return true;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return false;
}

function npmScript(name, extraEnv = {}) {
  const isWin = process.platform === "win32";
  const cmd = isWin ? "npm.cmd" : "npm";
  return spawn(cmd, ["run", name], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...extraEnv },
    shell: isWin,
  });
}

const apiFree = await portFree(API_PORT);
let webFree = await webDevPortFree(WEB_PORT);
if (!apiFree) console.warn(`[dev] Port ${API_PORT} may already be in use.`);
else console.log(`[dev] Port ${API_PORT} is free.`);

if (!webFree) {
  console.warn(`[dev] Frontend port ${WEB_PORT} is in use.`);
  if (tryReleasePort(WEB_PORT)) {
    await new Promise((r) => setTimeout(r, 800));
    webFree = await webDevPortFree(WEB_PORT);
  }
}
if (!webFree) {
  const pids = windowsListenerPids(WEB_PORT);
  console.error(
    `[dev] Cannot start Vite on port ${WEB_PORT}. Stop the other process${
      pids.length ? ` (PID: ${pids.join(", ")})` : ""
    } or set VITE_DEV_PORT to another port.`,
  );
  process.exit(1);
}
console.log(`[dev] Frontend port ${WEB_PORT} is free.`);

console.log("[dev] Waiting for API (bootstrap can take 30–60s).");
const api = npmScript("dev:backend");
const web = npmScript("dev");

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n[dev] Shutting down…");
  api.kill("SIGTERM");
  web.kill("SIGTERM");
  setTimeout(() => process.exit(code), 500);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

api.on("exit", (code) => {
  if (!shuttingDown) shutdown(code ?? 1);
});
web.on("exit", (code) => {
  if (!shuttingDown) shutdown(code ?? 1);
});

const ok = await waitForHealth();
if (ok) {
  console.log(`\n[dev] API ready on port ${API_PORT}`);
  console.log(`[dev] Frontend → http://127.0.0.1:${WEB_PORT}/  (API proxy → http://127.0.0.1:${API_PORT})\n`);
} else {
  console.error(`[dev] API did not become healthy at ${HEALTH_URL} within ${MAX_WAIT_MS / 1000}s`);
}