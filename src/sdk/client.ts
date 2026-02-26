/**
 * AsanaClient — the single injectable dependency threaded through every SDK call.
 *
 * Owns:
 *  - A bound `request` function (HTTP, auth injected)
 *  - A bound `paginate` helper
 *  - Lazy workspace GID resolution (cached per client instance)
 *
 * No module-level state. All caches live on the client object.
 */

import { createRequestFn, paginate, ASANA_BASE_URL, type RequestFn, type QueryParams } from "./http.ts";
import { type ApiEnvelope } from "./http.ts";
import { SdkError } from "./errors.ts";
import { type AsanaWorkspace } from "./types.ts";

// ── Config ───────────────────────────────────────────────────────────

export type WorkspaceSource = "explicit" | "env" | "config" | "fallback";

export type ClientConfig = {
  /** Bearer token for Asana API. */
  readonly token: string;
  /** Optional explicit workspace GID or name. Takes precedence over env/config. */
  readonly workspaceRef?: string;
  /** Directory to search for .asana-cli.json (default: cwd). */
  readonly configDir?: string;
  /** Asana API base URL (override for testing). */
  readonly baseUrl?: string;
  /** Custom fetch implementation (for testing). */
  readonly fetchImpl?: typeof fetch;
};

// ── Public interface ─────────────────────────────────────────────────

export type AsanaClient = {
  /** Raw request function — prefer domain SDK functions over calling this directly. */
  readonly request: RequestFn;
  /** Paginated GET helper. */
  readonly paginate: <T>(path: string, query?: QueryParams, maxItems?: number) => Promise<T[]>;
  /** Resolved workspace GID (lazy, cached). */
  getWorkspaceGid(): Promise<string>;
  /** Resolved workspace with resolution source (for debugging). */
  getWorkspace(): Promise<{ gid: string; name?: string; source: WorkspaceSource }>;
  /** Config used to create this client (for cloning / worker bridge). */
  readonly config: Readonly<ClientConfig>;
};

// ── Workspace cache ──────────────────────────────────────────────────

type CachedWorkspace = { gid: string; name?: string; source: WorkspaceSource };

const WORKSPACE_OPT_FIELDS = "gid,name,is_default";

async function fetchWorkspaces(request: RequestFn): Promise<AsanaWorkspace[]> {
  const res = await request<AsanaWorkspace[]>("GET", "/workspaces", {
    query: { opt_fields: WORKSPACE_OPT_FIELDS, limit: 100 },
  });
  return [...(res.data as AsanaWorkspace[])].sort((a, b) =>
    (a.name ?? a.gid).toLowerCase().localeCompare((b.name ?? b.gid).toLowerCase()),
  );
}

function pickByRef(workspaces: AsanaWorkspace[], ref: string): AsanaWorkspace | undefined {
  const trimmed = ref.trim();
  if (/^\d+$/.test(trimmed)) return workspaces.find((w) => w.gid === trimmed);
  const lower = trimmed.toLowerCase();
  const exact = workspaces.filter((w) => (w.name ?? "").toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    throw new SdkError(
      `Workspace "${trimmed}" is ambiguous (${exact.length} matches).`,
      "AMBIGUOUS_WORKSPACE",
      "Use the workspace GID instead of name to disambiguate.",
    );
  }
  return undefined;
}

async function resolveWorkspace(
  request: RequestFn,
  config: ClientConfig,
): Promise<CachedWorkspace> {
  const workspaces = await fetchWorkspaces(request);
  if (workspaces.length === 0) {
    throw new SdkError(
      "No workspaces found for this token.",
      "NO_WORKSPACE",
      "Verify the token belongs to an Asana user with workspace access.",
    );
  }

  // 1. Explicit ref (from --workspace flag or constructor)
  if (config.workspaceRef) {
    const ws = pickByRef(workspaces, config.workspaceRef);
    if (!ws) {
      throw new SdkError(
        `Workspace "${config.workspaceRef}" not found.`,
        "WORKSPACE_NOT_FOUND",
        "Run 'asana-cli workspaces' to list accessible workspaces.",
      );
    }
    return { gid: ws.gid, name: ws.name, source: "explicit" };
  }

  // 2. Environment variable
  const envGid = process.env.ASANA_WORKSPACE_GID?.trim();
  if (envGid) {
    const ws = pickByRef(workspaces, envGid);
    if (!ws) {
      throw new SdkError(
        `ASANA_WORKSPACE_GID="${envGid}" not found.`,
        "WORKSPACE_NOT_FOUND",
        "Correct ASANA_WORKSPACE_GID or unset it to use the fallback.",
      );
    }
    return { gid: ws.gid, name: ws.name, source: "env" };
  }

  // 3. .asana-cli.json in configDir
  const configGid = await loadConfigWorkspace(config.configDir ?? process.cwd());
  if (configGid) {
    const ws = pickByRef(workspaces, configGid);
    if (!ws) {
      throw new SdkError(
        `Workspace "${configGid}" from .asana-cli.json not found.`,
        "WORKSPACE_NOT_FOUND",
        "Update workspace_gid in .asana-cli.json or remove it to use fallback.",
      );
    }
    return { gid: ws.gid, name: ws.name, source: "config" };
  }

  // 4. Lexicographic fallback (first sorted workspace)
  const ws = workspaces[0];
  return { gid: ws.gid, name: ws.name, source: "fallback" };
}

async function loadConfigWorkspace(dir: string): Promise<string | undefined> {
  const { join } = await import("node:path");
  const { readFile } = await import("node:fs/promises");
  try {
    const raw = await readFile(join(dir, ".asana-cli.json"), "utf8");
    const parsed = JSON.parse(raw) as { workspace_gid?: string; workspace?: string };
    return parsed.workspace_gid ?? parsed.workspace;
  } catch {
    return undefined;
  }
}

// ── Factory ──────────────────────────────────────────────────────────

/**
 * Creates an AsanaClient from a bearer token.
 *
 * @example
 * const client = createClient({ token: process.env.ASANA_ACCESS_TOKEN! });
 * const gid = await client.getWorkspaceGid();
 */
export function createClient(config: ClientConfig): AsanaClient {
  if (!config.token || !config.token.trim()) {
    throw new SdkError(
      "Asana bearer token is required.",
      "AUTH_MISSING",
      "Set ASANA_ACCESS_TOKEN or pass token to createClient().",
    );
  }

  const request = createRequestFn(
    config.token,
    config.baseUrl ?? ASANA_BASE_URL,
    config.fetchImpl,
  );

  let workspaceCache: CachedWorkspace | undefined;

  const client: AsanaClient = {
    config,
    request,
    paginate: <T>(path: string, query?: QueryParams, maxItems?: number) =>
      paginate<T>(request, path, query, maxItems),

    async getWorkspace(): Promise<{ gid: string; name?: string; source: WorkspaceSource }> {
      if (!workspaceCache) {
        workspaceCache = await resolveWorkspace(request, config);
      }
      return workspaceCache;
    },

    async getWorkspaceGid(): Promise<string> {
      return (await client.getWorkspace()).gid;
    },
  };

  return client;
}

/**
 * Creates a client from the authenticated user's environment.
 * Reads ASANA_ACCESS_TOKEN → ASANA_TOKEN → ASANA_PAT → agent-secrets.
 * Throws SdkError with AUTH_MISSING if no token is found.
 */
export async function createClientFromEnv(overrides?: Partial<ClientConfig>): Promise<AsanaClient> {
  const token = resolveTokenFromEnv() ?? (await resolveTokenFromSecrets());
  if (!token) {
    throw new SdkError(
      "No Asana token found. Set ASANA_ACCESS_TOKEN or configure agent-secrets.",
      "AUTH_MISSING",
      "Create a token at https://app.asana.com/0/developer-console",
    );
  }
  return createClient({ token, ...overrides });
}

function resolveTokenFromEnv(): string | undefined {
  const keys = ["ASANA_ACCESS_TOKEN", "ASANA_TOKEN", "ASANA_PAT"] as const;
  for (const key of keys) {
    const val = process.env[key]?.trim();
    if (val) return val;
  }
  return undefined;
}

async function resolveTokenFromSecrets(): Promise<string | undefined> {
  const { execFileSync } = await import("node:child_process");
  try {
    const stdout = execFileSync("secrets", ["get", "asana_access_token"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const trimmed = stdout.trim();
    if (!trimmed) return undefined;
    if (trimmed.startsWith("{")) {
      const parsed = JSON.parse(trimmed) as { value?: string };
      return parsed.value?.trim() || undefined;
    }
    return trimmed || undefined;
  } catch {
    return undefined;
  }
}
