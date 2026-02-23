import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { api } from "../http/http-json-client";
import { fatal } from "../../output.ts";
import { getRuntimeWorkspaceRef } from "./cli-context";

type AsanaWorkspace = {
  readonly gid: string;
  readonly name?: string;
  readonly is_default?: boolean;
};

type LocalConfig = {
  readonly workspace?: string;
  readonly workspace_gid?: string;
};

export type WorkspaceResolution = {
  readonly workspace: AsanaWorkspace;
  readonly source: "flag" | "env" | "config" | "fallback";
};

let cachedWorkspaces: AsanaWorkspace[] | undefined;
let cachedResolution: WorkspaceResolution | undefined;

const WORKSPACE_OPT_FIELDS = "gid,name,is_default";
const LOCAL_CONFIG_FILE = ".asana-cli.json";

function normalizeName(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function byWorkspaceSort(a: AsanaWorkspace, b: AsanaWorkspace): number {
  const nameCmp = normalizeName(a.name).localeCompare(normalizeName(b.name));
  if (nameCmp !== 0) return nameCmp;
  return a.gid.localeCompare(b.gid);
}

function looksLikeGid(ref: string): boolean {
  return /^\d+$/.test(ref.trim());
}

async function loadLocalConfigDefault(): Promise<string | undefined> {
  const path = join(process.cwd(), LOCAL_CONFIG_FILE);
  try {
    const content = await readFile(path, "utf8");
    const parsed = JSON.parse(content) as LocalConfig;
    return parsed.workspace_gid ?? parsed.workspace;
  } catch {
    return undefined;
  }
}

export async function listWorkspaces(): Promise<AsanaWorkspace[]> {
  if (cachedWorkspaces) return cachedWorkspaces;
  const res = await api<AsanaWorkspace[]>("GET", "/workspaces", {
    query: { opt_fields: WORKSPACE_OPT_FIELDS, limit: 100 },
  });
  cachedWorkspaces = [...res.data].sort(byWorkspaceSort);
  return cachedWorkspaces;
}

function resolveWorkspaceRefOrFatal(workspaces: AsanaWorkspace[], ref: string, source: WorkspaceResolution["source"]): AsanaWorkspace {
  const trimmed = ref.trim();
  if (!trimmed) {
    fatal("Workspace reference cannot be empty.", {
      code: "INVALID_INPUT",
      fix: "Provide --workspace <name|gid> or set ASANA_WORKSPACE_GID.",
    });
  }

  if (looksLikeGid(trimmed)) {
    const byGid = workspaces.find((x) => x.gid === trimmed);
    if (byGid) return byGid;
    fatal(`Workspace "${trimmed}" is not accessible with this token.`, {
      code: "WORKSPACE_NOT_FOUND",
      fix: "Run 'asana-cli workspaces' and choose a valid workspace id.",
    });
  }

  const exact = workspaces.filter((x) => normalizeName(x.name) === normalizeName(trimmed));
  if (exact.length === 1) return exact[0];
  if (exact.length > 1) {
    fatal(`Workspace "${trimmed}" is ambiguous (${source}).`, {
      code: "AMBIGUOUS_WORKSPACE",
      fix: "Use --workspace <gid> to disambiguate duplicate workspace names.",
    });
  }

  fatal(`Workspace "${trimmed}" not found.`, {
    code: "WORKSPACE_NOT_FOUND",
    fix: "Run 'asana-cli workspaces' and use an exact workspace name or gid.",
  });
}

export async function resolveWorkspaceByRef(ref: string): Promise<AsanaWorkspace> {
  return resolveWorkspaceRefOrFatal(await listWorkspaces(), ref, "flag");
}

export async function resolveWorkspace(): Promise<WorkspaceResolution> {
  if (cachedResolution) return cachedResolution;

  const workspaces = await listWorkspaces();
  if (workspaces.length === 0) {
    fatal("No workspaces found for the authenticated user.", {
      code: "NO_WORKSPACE",
      fix: "Confirm the token belongs to an Asana user with workspace access.",
    });
  }

  const workspaceFromFlag = getRuntimeWorkspaceRef();
  if (workspaceFromFlag) {
    const workspace = resolveWorkspaceRefOrFatal(workspaces, workspaceFromFlag, "flag");
    cachedResolution = { workspace, source: "flag" };
    return cachedResolution;
  }

  const envWorkspace = process.env.ASANA_WORKSPACE_GID?.trim();
  if (envWorkspace) {
    const workspace = resolveWorkspaceRefOrFatal(workspaces, envWorkspace, "env");
    cachedResolution = { workspace, source: "env" };
    return cachedResolution;
  }

  const configWorkspace = await loadLocalConfigDefault();
  if (configWorkspace) {
    const workspace = resolveWorkspaceRefOrFatal(workspaces, configWorkspace, "config");
    cachedResolution = { workspace, source: "config" };
    return cachedResolution;
  }

  const sorted = [...workspaces].sort(byWorkspaceSort);
  cachedResolution = { workspace: sorted[0], source: "fallback" };
  return cachedResolution;
}

export async function getDefaultWorkspaceGid(): Promise<string> {
  return (await resolveWorkspace()).workspace.gid;
}

export function clearWorkspaceCache(): void {
  cachedWorkspaces = undefined;
  cachedResolution = undefined;
}
