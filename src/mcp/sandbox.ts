/**
 * Sandbox execution for agent scripts.
 *
 * Isolation model:
 *  - Each execute() call gets a fresh Bun Worker (separate thread, own event loop)
 *  - Worker code is a Blob-based module — no filesystem access to SDK source
 *  - Agent code communicates via message-passing bridge (WorkerCallMessage pattern)
 *  - Main thread executes all SDK calls; worker never touches auth tokens directly
 *  - Hung scripts are killed via AbortSignal.timeout + worker.terminate()
 *
 * Execution flow:
 *  1. Build worker preamble (bridge setup + asana proxy + context injection)
 *  2. Wrap user code in async IIFE
 *  3. Create Blob → URL → Worker
 *  4. Main thread message handler routes calls to real SDK
 *  5. Worker posts { type: "done", value } or { type: "fatal", error }
 *  6. Worker is terminated after completion or timeout
 */

import { type AsanaClient } from "../sdk/client.ts";
import { type SessionState, snapshotSession } from "./session.ts";
import {
  RateLimiter,
  createDispatchTable,
  createMessageHandler,
} from "./bridge.ts";
import { type WorkerToMainMessage } from "./types.ts";

export type SandboxResult = {
  readonly ok: true;
  readonly value: unknown;
  readonly progressMessages: readonly string[];
} | {
  readonly ok: false;
  readonly error: {
    readonly message: string;
    readonly code?: string;
    readonly fix?: string;
  };
  readonly progressMessages: readonly string[];
};

export type SandboxOpts = {
  /** Abort signal controlling max execution time. Defaults to 30 seconds. */
  readonly signal?: AbortSignal;
  /** Called for each progress message emitted by the worker. */
  readonly onProgress?: (message: string) => void;
};

const DEFAULT_TIMEOUT_MS = 30_000;

// ── Worker preamble ───────────────────────────────────────────────────
//
// This JS code is injected before every agent script. It sets up the
// message-passing bridge and exposes the `asana` namespace + `context`.

function buildWorkerPreamble(sessionSnapshot: Record<string, unknown>): string {
  return `
// ── Bridge setup ──────────────────────────────────────────────
const __bridge = {
  pending: new Map(),
  nextId: 0,
  call(namespace, method, args) {
    return new Promise((resolve, reject) => {
      const id = __bridge.nextId++;
      __bridge.pending.set(id, { resolve, reject });
      self.postMessage({ type: "call", id, namespace, method, args: Array.from(args) });
    });
  }
};

self.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "result") {
    const p = __bridge.pending.get(msg.id);
    if (p) { __bridge.pending.delete(msg.id); p.resolve(msg.value); }
  } else if (msg.type === "error") {
    const p = __bridge.pending.get(msg.id);
    if (p) {
      __bridge.pending.delete(msg.id);
      const err = Object.assign(new Error(msg.error.message), msg.error);
      p.reject(err);
    }
  }
});

// ── asana proxy ───────────────────────────────────────────────
const asana = new Proxy({}, {
  get(_, namespace) {
    return new Proxy({}, {
      get(_, method) {
        return (...args) => __bridge.call(String(namespace), String(method), args);
      }
    });
  }
});

// ── context (session state) ───────────────────────────────────
const context = new Proxy(${JSON.stringify(sessionSnapshot)}, {
  set(target, key, value) {
    target[key] = value;
    self.postMessage({ type: "session-update", key: String(key), value });
    return true;
  }
});

// ── progress helper ───────────────────────────────────────────
function progress(message) {
  self.postMessage({ type: "progress", message: String(message) });
}

// ── User code wrapper ─────────────────────────────────────────
`;
}

function buildWorkerScript(userCode: string, sessionSnapshot: Record<string, unknown>): string {
  const preamble = buildWorkerPreamble(sessionSnapshot);
  return `${preamble}
(async function __userCode() {
${userCode}
})()
  .then((result) => self.postMessage({ type: "done", value: result ?? null }))
  .catch((err) => self.postMessage({
    type: "fatal",
    error: {
      message: err?.message ?? String(err),
      code: err?.code,
      fix: err?.fix,
    }
  }));
`;
}

// ── Sandbox execution ─────────────────────────────────────────────────

/**
 * Executes agent JS code in an isolated Bun Worker with the bridge pattern.
 *
 * The agent code has access to:
 *   - `asana.*.*(...args)` — all documented SDK methods via message bridge
 *   - `context` — mutable session state proxy (assignments → session-update messages)
 *   - `progress(message)` — emit incremental status messages
 *
 * Returns a SandboxResult — never throws. All errors are caught and serialized.
 */
export async function executeInSandbox(
  userCode: string,
  client: AsanaClient,
  session: SessionState,
  opts: SandboxOpts = {},
): Promise<SandboxResult> {
  const progressMessages: string[] = [];
  const onProgress = opts.onProgress ?? ((msg: string) => { progressMessages.push(msg); });

  const sessionSnapshot = snapshotSession(session);
  const script = buildWorkerScript(userCode, sessionSnapshot);

  // Create blob worker — no filesystem access to SDK source from worker
  const blob = new Blob([script], { type: "application/javascript" });
  const blobUrl = URL.createObjectURL(blob);

  const rateLimiter = new RateLimiter();
  const dispatchTable = createDispatchTable(client);

  const signal = opts.signal ?? AbortSignal.timeout(DEFAULT_TIMEOUT_MS);

  return new Promise<SandboxResult>((resolve) => {
    let settled = false;
    let worker: Worker | undefined;

    function settle(result: SandboxResult) {
      if (settled) return;
      settled = true;
      worker?.terminate();
      URL.revokeObjectURL(blobUrl);
      resolve(result);
    }

    try {
      worker = new Worker(blobUrl, { type: "module" });
    } catch (err: unknown) {
      settle({
        ok: false,
        error: { message: `Failed to create worker: ${err instanceof Error ? err.message : String(err)}` },
        progressMessages,
      });
      return;
    }

    // Route incoming worker messages
    worker.addEventListener("message", createMessageHandler(
      worker,
      dispatchTable,
      rateLimiter,
      client,
      session,
      (msg) => {
        progressMessages.push(msg);
        onProgress(msg);
      },
      () => { /* session updates already applied by createMessageHandler */ },
    ));

    // Watch for done/fatal from worker
    worker.addEventListener("message", (event: MessageEvent) => {
      const msg = event.data as WorkerToMainMessage;
      if (msg.type === "done") {
        settle({ ok: true, value: msg.value, progressMessages });
      } else if (msg.type === "fatal") {
        settle({ ok: false, error: msg.error, progressMessages });
      }
    });

    // Worker thread error (syntax error, uncaught throw outside async IIFE)
    worker.addEventListener("error", (event: ErrorEvent) => {
      settle({
        ok: false,
        error: { message: event.message ?? "Worker error" },
        progressMessages,
      });
    });

    // Timeout via AbortSignal
    signal.addEventListener("abort", () => {
      settle({
        ok: false,
        error: {
          message: `Script timed out after ${DEFAULT_TIMEOUT_MS}ms`,
          code: "COMMAND_FAILED",
          fix: "Break the script into smaller steps or increase the timeout.",
        },
        progressMessages,
      });
    }, { once: true });
  });
}
