import { execSync } from "node:child_process";
import { fatal } from "./output.ts";
import type { AsanaUser } from "./types.ts";

// ── Auth ────────────────────────────────────────────────────────────

function getToken(): string {
  const env = process.env.ASANA_ACCESS_TOKEN;
  if (env) return env;

  try {
    const token = execSync("secrets lease asana_access_token --ttl 1h 2>/dev/null", {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    if (token) return token;
  } catch {
    /* agent-secrets not available */
  }

  fatal(
    "No ASANA_ACCESS_TOKEN found.",
    {
      code: "AUTH_MISSING",
      fix: "Set via: export ASANA_ACCESS_TOKEN=<token> or: secrets add asana_access_token. Create a token at: https://app.asana.com/0/developer-console",
    },
  );
}

// ── HTTP Client ─────────────────────────────────────────────────────

const BASE = "https://app.asana.com/api/1.0";

export type QueryParams = Record<string, string | number | boolean | undefined>;

function buildUrl(path: string, query?: QueryParams): URL {
  const url = new URL(`${BASE}${path}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
  }
  return url;
}

function buildApiError(method: string, path: string, status: number, text: string): Error {
  let detail: string;
  try {
    detail = JSON.parse(text).errors?.[0]?.message ?? text;
  } catch {
    detail = text;
  }
  return new Error(`Asana API ${method} ${path} → ${status}: ${detail}`);
}

export async function api<T = any>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  opts?: { query?: QueryParams; body?: unknown },
): Promise<{ data: T }> {
  const url = buildUrl(path, opts?.query);
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${getToken()}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    ...(opts?.body ? { body: JSON.stringify({ data: opts.body }) } : {}),
  });

  if (!res.ok) throw buildApiError(method, path, res.status, await res.text());
  if (res.status === 204 || method === "DELETE") return { data: {} as T };
  return res.json();
}

/**
 * Collects all pages using Asana's offset-based pagination.
 */
export async function paginate<T>(path: string, query: QueryParams = {}): Promise<T[]> {
  const all: T[] = [];
  let offset: string | undefined;
  do {
    const url = buildUrl(path, query);
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${getToken()}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) throw buildApiError("GET", path, res.status, await res.text());
    const json = await res.json();
    if (json.data) all.push(...json.data);
    offset = json.next_page?.offset;
  } while (offset);
  return all;
}

// ── Default Workspace ───────────────────────────────────────────────

let cachedWorkspaceGid: string | null = null;

export async function getDefaultWorkspaceGid(): Promise<string> {
  if (cachedWorkspaceGid) return cachedWorkspaceGid;
  const res = await api<AsanaUser>("GET", "/users/me", {
    query: { opt_fields: "workspaces,workspaces.gid,workspaces.name" },
  });
  const workspaces = res.data?.workspaces ?? [];
  if (workspaces.length === 0) {
    fatal("No workspaces found for the authenticated user.", {
      code: "NO_WORKSPACE",
      fix: "Verify your Asana account has at least one workspace.",
    });
  }
  cachedWorkspaceGid = workspaces[0].gid;
  return cachedWorkspaceGid;
}
