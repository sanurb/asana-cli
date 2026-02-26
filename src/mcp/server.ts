/**
 * MCP server — stdio transport.
 *
 * Framing: newline-delimited JSON messages on stdin/stdout.
 * Single connection; session state lives in memory for the lifetime of the process.
 *
 * Phase 3 features included:
 *  - Session state: context object injected per execute() call
 *  - Streaming: progress notifications via notifications/progress
 *  - execute() code has access to asana.*, context, and progress()
 */

import pkg from "../../package.json" with { type: "json" };
import {
  type JsonRpcRequest,
  type JsonRpcResponse,
  type JsonRpcErrorResponse,
  type JsonRpcNotification,
  type McpInitializeResult,
  type McpToolsListResult,
  type McpCallToolParams,
  type McpCallToolResult,
  type McpTool,
  JSONRPC_ERRORS,
} from "./types.ts";
import { createClientFromEnv } from "../sdk/client.ts";
import { createSession, type SessionState } from "./session.ts";
import { executeInSandbox } from "./sandbox.ts";

// ── Tool definition ───────────────────────────────────────────────────

const EXECUTE_TOOL: McpTool = {
  name: "execute",
  description: `Execute a JavaScript script against the Asana SDK.

The script has access to:
  - \`asana\` namespace with methods for all Asana operations
  - \`context\` object for session persistence across calls
  - \`progress(message)\` to emit incremental status

## Available methods

**Tasks:** asana.tasks.add(opts), asana.tasks.get(gid), asana.tasks.list(opts?),
  asana.tasks.complete(gid), asana.tasks.reopen(gid), asana.tasks.update(gid, fields),
  asana.tasks.delete(gid), asana.tasks.addToProject(taskGid, projGid),
  asana.tasks.removeFromProject(taskGid, projGid), asana.tasks.listProject(projGid, opts?)

**Projects:** asana.projects.list(opts?), asana.projects.get(gid), asana.projects.add(name, workspaceGid)

**Sections:** asana.sections.list(projGid), asana.sections.add(projGid, name),
  asana.sections.moveTask(sectionGid, taskGid, opts?)

**Comments:** asana.comments.list(taskGid), asana.comments.add(taskGid, text),
  asana.comments.update(storyGid, text), asana.comments.delete(storyGid)

**Users:** asana.users.me(), asana.users.list(workspaceGid)

**Tags:** asana.tags.list()

**Workspace:** asana.workspace.gid(), asana.workspace.info()

**Refs:** asana.refs.resolveTask(ref), asana.refs.resolveProject(ref)

**Dependencies:** asana.deps.get(taskGid), asana.deps.add(taskGid, blockedByGid),
  asana.deps.remove(taskGid, blockedByGid)

## Examples

\`\`\`js
// Create and complete a task
const task = await asana.tasks.add({
  name: "Ship the feature",
  workspaceGid: await asana.workspace.gid(),
  due_on: "2026-03-01"
});
progress("Created task: " + task.gid);
await asana.tasks.complete(task.gid);
return { created: task.gid, completed: true };
\`\`\`

\`\`\`js
// Batch create tasks from a list
const names = ["Task A", "Task B", "Task C"];
const wsGid = await asana.workspace.gid();
const created = await Promise.all(
  names.map(name => asana.tasks.add({ name, workspaceGid: wsGid }))
);
context.lastBatch = created.map(t => t.gid);
return { created: created.length, gids: context.lastBatch };
\`\`\`

Return a value from the script and it will appear in the tool result.`,
  inputSchema: {
    type: "object",
    properties: {
      code: {
        type: "string",
        description: "JavaScript code to execute. May be async. The return value becomes the result.",
      },
      timeout_ms: {
        type: "number",
        description: "Maximum execution time in milliseconds. Default: 30000.",
      },
    },
    required: ["code"],
  },
};

// ── JSON-RPC framing ──────────────────────────────────────────────────

function makeResponse<T>(id: string | number | null, result: T): string {
  const res: JsonRpcResponse<T> = { jsonrpc: "2.0", id, result };
  return JSON.stringify(res);
}

function makeError(id: string | number | null, code: number, message: string, data?: unknown): string {
  const res: JsonRpcErrorResponse = {
    jsonrpc: "2.0",
    id,
    error: { code, message, ...(data !== undefined ? { data } : {}) },
  };
  return JSON.stringify(res);
}

function makeNotification(method: string, params: unknown): string {
  const msg: JsonRpcNotification = { jsonrpc: "2.0", method, params };
  return JSON.stringify(msg);
}

function sendLine(line: string): void {
  process.stdout.write(line + "\n");
}

// ── Request handlers ──────────────────────────────────────────────────

function handleInitialize(
  id: string | number | null,
): string {
  const result: McpInitializeResult = {
    protocolVersion: "2024-11-05",
    capabilities: { tools: {} },
    serverInfo: { name: "asana-cli", version: pkg.version },
  };
  return makeResponse(id, result);
}

function handleToolsList(id: string | number | null): string {
  const result: McpToolsListResult = { tools: [EXECUTE_TOOL] };
  return makeResponse(id, result);
}

async function handleToolsCall(
  id: string | number | null,
  params: McpCallToolParams,
  client: import("../sdk/client.ts").AsanaClient,
  session: SessionState,
): Promise<string> {
  if (params.name !== "execute") {
    return makeError(id, JSONRPC_ERRORS.INVALID_PARAMS, `Unknown tool: ${params.name}`);
  }

  const code = params.arguments?.code;
  if (typeof code !== "string" || !code.trim()) {
    return makeError(id, JSONRPC_ERRORS.INVALID_PARAMS, "Parameter 'code' must be a non-empty string");
  }

  const timeoutMs = typeof params.arguments?.timeout_ms === "number"
    ? params.arguments.timeout_ms
    : 30_000;

  const progressToken = params._meta?.progressToken;
  let progressCount = 0;

  const result = await executeInSandbox(code, client, session, {
    signal: AbortSignal.timeout(timeoutMs),
    onProgress: (message) => {
      // Stream progress to MCP client if progressToken was provided
      if (progressToken !== undefined) {
        const notification = makeNotification("notifications/progress", {
          progressToken,
          progress: ++progressCount,
          message,
        });
        sendLine(notification);
      }
    },
  });

  if (result.ok) {
    const content: McpCallToolResult = {
      content: [
        {
          type: "text",
          text: JSON.stringify({
            ok: true,
            value: result.value,
            progress: result.progressMessages,
          }, null, 2),
        },
      ],
    };
    return makeResponse(id, content);
  }

  // Error from sandbox — isError=true signals tool-level failure to the MCP client
  const content: McpCallToolResult = {
    isError: true,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          ok: false,
          error: result.error,
          progress: result.progressMessages,
          fix: result.error.fix ?? "Review the script for errors and retry.",
        }, null, 2),
      },
    ],
  };
  return makeResponse(id, content);
}

// ── Server main loop ──────────────────────────────────────────────────

/**
 * Starts the MCP server over stdio (newline-delimited JSON-RPC).
 * Runs until stdin closes or process is killed.
 */
export async function startMcpServer(): Promise<void> {
  // Resolve client before starting — fail fast if auth missing
  const client = await createClientFromEnv();
  const session = createSession();

  const decoder = new TextDecoder();
  let buffer = "";

  // Send initialization notification
  sendLine(makeNotification("notifications/message", {
    level: "info",
    logger: "asana-cli",
    data: { message: `asana-cli MCP server v${pkg.version} started` },
  }));

  for await (const chunk of process.stdin) {
    buffer += decoder.decode(chunk as Uint8Array, { stream: true });

    // Process all complete lines (newline-delimited JSON)
    const lines = buffer.split("\n");
    // Last element is incomplete (no trailing newline yet)
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let request: JsonRpcRequest;
      try {
        request = JSON.parse(trimmed) as JsonRpcRequest;
      } catch {
        sendLine(makeError(null, JSONRPC_ERRORS.PARSE_ERROR, "Parse error"));
        continue;
      }

      if (request.jsonrpc !== "2.0") {
        sendLine(makeError(request.id ?? null, JSONRPC_ERRORS.INVALID_REQUEST, "Invalid JSON-RPC version"));
        continue;
      }

      const id = request.id ?? null;

      try {
        let response: string;

        switch (request.method) {
          case "initialize":
            response = handleInitialize(id);
            break;

          case "initialized":
            // Notification — no response needed
            continue;

          case "tools/list":
            response = handleToolsList(id);
            break;

          case "tools/call":
            response = await handleToolsCall(
              id,
              request.params as McpCallToolParams,
              client,
              session,
            );
            break;

          case "ping":
            response = makeResponse(id, {});
            break;

          default:
            response = makeError(id, JSONRPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${request.method}`);
        }

        sendLine(response);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        sendLine(makeError(id, JSONRPC_ERRORS.INTERNAL_ERROR, message));
      }
    }
  }

}
