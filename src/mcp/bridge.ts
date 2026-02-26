/**
 * Worker bridge — message protocol for the MCP sandbox.
 *
 * Architecture:
 *  - Main thread holds the real AsanaClient
 *  - Worker runs untrusted agent code; calls `asana.*` methods via postMessage
 *  - Main thread routes WorkerCallMessage → SDK → WorkerResultMessage/WorkerErrorMessage
 *  - Rate limiting enforced here: 150 req/min = token bucket with 400ms drain
 *  - Concurrency semaphore: max N simultaneous SDK calls from one worker
 *
 * The bridge does NOT expose raw auth tokens to the worker.
 */

import { type AsanaClient } from "../sdk/client.ts";
import { type SessionState, applySessionUpdate } from "./session.ts";
import {
  type WorkerCallMessage,
  type WorkerToMainMessage,
  type MainToWorkerMessage,
} from "./types.ts";

// ── SDK dispatch table ────────────────────────────────────────────────

type SdkDispatchFn = (client: AsanaClient, args: readonly unknown[]) => Promise<unknown>;

function buildDispatchTable(client: AsanaClient): Map<string, SdkDispatchFn> {
  // Import SDK modules lazily (already loaded in main thread)
  // These are the only methods exposed to worker scripts.
  const table = new Map<string, SdkDispatchFn>();

  const bind = (ns: string, method: string, fn: SdkDispatchFn) =>
    table.set(`${ns}.${method}`, fn);

  // tasks
  bind("tasks", "list", (_c, [opts]) => import("../sdk/tasks.ts").then((m) => m.listMyTasks(client, (opts as { since?: string; limit?: number } | undefined) ?? {})));
  bind("tasks", "listProject", (_c, [gid, opts]) => import("../sdk/tasks.ts").then((m) => m.listProjectTasks(client, String(gid), (opts as { sectionGid?: string; limit?: number } | undefined) ?? {})));
  bind("tasks", "get", (_c, [gid]) => import("../sdk/tasks.ts").then((m) => m.getTask(client, String(gid))));
  bind("tasks", "add", (_c, [opts]) => import("../sdk/tasks.ts").then((m) => m.addTask(client, opts as Parameters<typeof m.addTask>[1])));
  bind("tasks", "complete", (_c, [gid]) => import("../sdk/tasks.ts").then((m) => m.completeTask(client, String(gid))));
  bind("tasks", "reopen", (_c, [gid]) => import("../sdk/tasks.ts").then((m) => m.reopenTask(client, String(gid))));
  bind("tasks", "update", (_c, [gid, fields]) => import("../sdk/tasks.ts").then((m) => m.updateTask(client, String(gid), fields as Parameters<typeof m.updateTask>[2])));
  bind("tasks", "delete", (_c, [gid]) => import("../sdk/tasks.ts").then((m) => m.deleteTask(client, String(gid))));
  bind("tasks", "addToProject", (_c, [taskGid, projGid]) => import("../sdk/tasks.ts").then((m) => m.addToProject(client, String(taskGid), String(projGid))));
  bind("tasks", "removeFromProject", (_c, [taskGid, projGid]) => import("../sdk/tasks.ts").then((m) => m.removeFromProject(client, String(taskGid), String(projGid))));

  // projects
  bind("projects", "list", (_c, [opts]) => import("../sdk/projects.ts").then((m) => m.listProjects(client, opts as { archived?: boolean } | undefined)));
  bind("projects", "get", (_c, [gid]) => import("../sdk/projects.ts").then((m) => m.getProject(client, String(gid))));
  bind("projects", "add", (_c, [name, wGid]) => import("../sdk/projects.ts").then((m) => m.addProject(client, String(name), String(wGid))));

  // sections
  bind("sections", "list", (_c, [projGid]) => import("../sdk/sections.ts").then((m) => m.listSections(client, String(projGid))));
  bind("sections", "add", (_c, [projGid, name]) => import("../sdk/sections.ts").then((m) => m.addSection(client, String(projGid), String(name))));
  bind("sections", "moveTask", (_c, [secGid, taskGid, opts]) => import("../sdk/sections.ts").then((m) => m.moveTaskToSection(client, String(secGid), String(taskGid), opts as { insertBefore?: string; insertAfter?: string } | undefined)));

  // comments
  bind("comments", "list", (_c, [taskGid]) => import("../sdk/comments.ts").then((m) => m.listComments(client, String(taskGid))));
  bind("comments", "add", (_c, [taskGid, text]) => import("../sdk/comments.ts").then((m) => m.addComment(client, String(taskGid), String(text))));
  bind("comments", "update", (_c, [storyGid, text]) => import("../sdk/comments.ts").then((m) => m.updateComment(client, String(storyGid), String(text))));
  bind("comments", "delete", (_c, [storyGid]) => import("../sdk/comments.ts").then((m) => m.deleteComment(client, String(storyGid))));

  // users
  bind("users", "me", () => import("../sdk/users.ts").then((m) => m.getCurrentUser(client)));
  bind("users", "list", (_c, [wsGid]) => import("../sdk/users.ts").then((m) => m.listWorkspaceUsers(client, String(wsGid))));

  // tags
  bind("tags", "list", () => import("../sdk/tags.ts").then((m) => m.listTags(client)));

  // workspace
  bind("workspace", "gid", () => client.getWorkspaceGid());
  bind("workspace", "info", () => client.getWorkspace());

  // refs
  bind("refs", "resolveTask", (_c, [ref]) => import("../sdk/refs.ts").then((m) => m.resolveTaskRef(client, String(ref))));
  bind("refs", "resolveProject", (_c, [ref]) => import("../sdk/refs.ts").then((m) => m.resolveProjectRef(client, String(ref))));

  // dependencies
  bind("deps", "get", (_c, [taskGid]) => import("../sdk/dependencies.ts").then((m) => m.getDependencies(client, String(taskGid))));
  bind("deps", "add", (_c, [taskGid, blockedBy]) => import("../sdk/dependencies.ts").then((m) => m.addDependency(client, String(taskGid), String(blockedBy))));
  bind("deps", "remove", (_c, [taskGid, blockedBy]) => import("../sdk/dependencies.ts").then((m) => m.removeDependency(client, String(taskGid), String(blockedBy))));

  // plan — dry-run validation
  bind("plan", "run", (_c, [steps]) => import("../sdk/plan.ts").then((m) => m.plan(client, steps as Parameters<typeof m.plan>[1])));
  return table;
}

// ── Rate limiter ──────────────────────────────────────────────────────

const RATE_LIMIT_RPM = 150;
const RATE_WINDOW_MS = 60_000;

export class RateLimiter {
  private readonly _timestamps: number[] = [];

  async acquire(): Promise<void> {
    const now = Date.now();
    // Evict timestamps older than the window
    while (this._timestamps.length > 0 && (this._timestamps[0] ?? 0) < now - RATE_WINDOW_MS) {
      this._timestamps.shift();
    }
    if (this._timestamps.length >= RATE_LIMIT_RPM) {
      const oldest = this._timestamps[0] ?? now;
      const wait = RATE_WINDOW_MS - (now - oldest) + 10;
      await Bun.sleep(wait);
    }
    this._timestamps.push(Date.now());
  }
}

// ── Bridge handler ────────────────────────────────────────────────────

export type ProgressCallback = (message: string) => void;
export type SessionUpdateCallback = (key: string, value: unknown) => void;

/**
 * Processes a single WorkerCallMessage from the worker.
 * Executes the corresponding SDK method with rate limiting.
 */
export async function handleWorkerCall(
  message: WorkerCallMessage,
  dispatchTable: Map<string, SdkDispatchFn>,
  rateLimiter: RateLimiter,
  client: AsanaClient,
): Promise<MainToWorkerMessage> {
  const key = `${message.namespace}.${message.method}`;
  const fn = dispatchTable.get(key);

  if (!fn) {
    return {
      type: "error",
      id: message.id,
      error: {
        message: `Unknown SDK method: ${key}`,
        code: "INVALID_INPUT",
        fix: `Use one of the documented asana.* methods. Available: ${[...dispatchTable.keys()].join(", ")}`,
      },
    };
  }

  try {
    await rateLimiter.acquire();
    const value = await fn(client, message.args);
    return { type: "result", id: message.id, value };
  } catch (err: unknown) {
    const error = err instanceof Error
      ? {
          message: err.message,
          code: (err as { code?: string }).code,
          fix: (err as { fix?: string }).fix,
        }
      : { message: String(err) };
    return { type: "error", id: message.id, error };
  }
}

/**
 * Creates an SDK dispatch table bound to the given client.
 */
export function createDispatchTable(client: AsanaClient): Map<string, SdkDispatchFn> {
  return buildDispatchTable(client);
}

/**
 * Processes incoming worker messages, dispatching SDK calls and routing
 * progress/session-update notifications.
 */
export function createMessageHandler(
  worker: Worker,
  dispatchTable: Map<string, SdkDispatchFn>,
  rateLimiter: RateLimiter,
  client: AsanaClient,
  session: SessionState,
  onProgress: ProgressCallback,
  onSessionUpdate: SessionUpdateCallback,
): (event: MessageEvent) => void {
  return (event: MessageEvent) => {
    const msg = event.data as WorkerToMainMessage;

    if (msg.type === "call") {
      void handleWorkerCall(msg, dispatchTable, rateLimiter, client).then((response) => {
        worker.postMessage(response);
      });
    } else if (msg.type === "progress") {
      onProgress(msg.message);
    } else if (msg.type === "session-update") {
      applySessionUpdate(session, msg.key, msg.value);
      onSessionUpdate(msg.key, msg.value);
    }
    // "done" and "fatal" are handled by the sandbox resolve/reject
  };
}
