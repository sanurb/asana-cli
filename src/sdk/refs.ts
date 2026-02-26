/**
 * Reference resolution for tasks, projects, and sections.
 *
 * Accepts: task name (fuzzy), Asana URL, id:<gid>, or raw numeric GID.
 * Throws SdkError (never calls process.exit).
 */

import { SdkError, sdkError } from "./errors.ts";
import { type AsanaClient } from "./client.ts";
import { type AsanaTask, type AsanaProject, type AsanaSection, TASK_OPT_FIELDS, PROJECT_OPT_FIELDS } from "./types.ts";

// ── URL parsing ──────────────────────────────────────────────────────

const ASANA_TASK_URL = /^https?:\/\/app\.asana\.com\/(\d+)\/(\d+)\/(\d+)/;

function parseTaskUrl(url: string): string | null {
  return url.match(ASANA_TASK_URL)?.[3] ?? null;
}

function isIdRef(ref: string): boolean { return ref.startsWith("id:"); }
function extractId(ref: string): string { return ref.slice(3); }
function looksLikeGid(ref: string): boolean { return /^\d+$/.test(ref.trim()); }

// ── Fuzzy match ──────────────────────────────────────────────────────

function fuzzyMatch<T extends { name?: string; gid: string }>(
  items: T[],
  query: string,
  label: string,
): T {
  const sorted = [...items].sort((a, b) => (a.name ?? a.gid).localeCompare(b.name ?? b.gid));
  const lower = query.toLowerCase();
  const exact = sorted.filter((t) => t.name?.toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  const partial = sorted.filter((t) => t.name?.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    const candidates = partial.slice(0, 5).map((t) => `"${t.name}" (id:${t.gid})`).join(", ");
    sdkError(
      `Ambiguous ${label} "${query}". Matches: ${candidates}`,
      "AMBIGUOUS_REF",
      `Use an exact id: prefix to disambiguate, e.g. id:${partial[0].gid}`,
    );
  }
  sdkError(
    `${label} "${query}" not found.`,
    "NOT_FOUND",
    `Use a name, Asana URL, or id:xxx. Run 'asana-cli search ${query}' to find tasks.`,
  );
}

// ── Task resolution ──────────────────────────────────────────────────

async function fetchTaskByGid(client: AsanaClient, gid: string): Promise<AsanaTask> {
  const res = await client.request<AsanaTask>("GET", `/tasks/${gid}`, {
    query: { opt_fields: TASK_OPT_FIELDS },
  });
  return res.data;
}

/**
 * Resolves a task reference (name, URL, id:xxx, or raw GID) to an AsanaTask.
 * Throws SdkError on failure.
 */
export async function resolveTaskRef(client: AsanaClient, ref: string): Promise<AsanaTask> {
  if (!ref.trim()) {
    sdkError("Task reference cannot be empty.", "INVALID_INPUT", "Provide a task name, URL, id:xxx, or GID.");
  }

  const urlGid = parseTaskUrl(ref);
  if (urlGid) return fetchTaskByGid(client, urlGid);
  if (isIdRef(ref)) return fetchTaskByGid(client, extractId(ref));

  if (looksLikeGid(ref)) {
    try { return await fetchTaskByGid(client, ref); } catch { /* fall through to search */ }
  }

  const workspace = await client.getWorkspaceGid();
  const tasks = await client.paginate<AsanaTask>("/tasks", {
    assignee: "me",
    workspace,
    completed_since: "now",
    opt_fields: TASK_OPT_FIELDS,
    limit: 100,
  });

  return fuzzyMatch(tasks, ref, "Task");
}

// ── Project resolution ───────────────────────────────────────────────

async function fetchProjectByGid(client: AsanaClient, gid: string): Promise<AsanaProject> {
  const res = await client.request<AsanaProject>("GET", `/projects/${gid}`, {
    query: { opt_fields: PROJECT_OPT_FIELDS },
  });
  return res.data;
}

/**
 * Resolves a project reference (name, id:xxx, or raw GID) to an AsanaProject.
 */
export async function resolveProjectRef(client: AsanaClient, ref: string): Promise<AsanaProject> {
  if (!ref.trim()) {
    sdkError("Project reference cannot be empty.", "INVALID_INPUT", "Provide a project name or id:xxx.");
  }
  if (isIdRef(ref)) return fetchProjectByGid(client, extractId(ref));
  if (looksLikeGid(ref)) {
    try { return await fetchProjectByGid(client, ref); } catch { /* fall through */ }
  }
  const workspace = await client.getWorkspaceGid();
  const projects = await client.paginate<AsanaProject>(`/workspaces/${workspace}/projects`, {
    opt_fields: PROJECT_OPT_FIELDS,
    archived: false,
    limit: 100,
  });
  return fuzzyMatch(projects, ref, "Project");
}

// ── Section resolution ───────────────────────────────────────────────

/**
 * Resolves a section reference within a known project GID.
 */
export async function resolveSectionRef(
  client: AsanaClient,
  projectGid: string,
  ref: string,
): Promise<AsanaSection> {
  const trimmed = ref.trim();
  if (!trimmed) {
    sdkError("Section reference cannot be empty.", "INVALID_INPUT", "Provide a section name or GID.");
  }

  const sections = await client.paginate<AsanaSection>(`/projects/${projectGid}/sections`, {
    opt_fields: "gid,name,project",
    limit: 100,
  });

  if (isIdRef(trimmed) || looksLikeGid(trimmed)) {
    const gid = isIdRef(trimmed) ? extractId(trimmed) : trimmed;
    const byId = sections.find((s) => s.gid === gid);
    if (!byId) {
      sdkError(
        `Section id:${gid} is not in project ${projectGid}.`,
        "NOT_FOUND",
        "Run 'asana-cli sections --project <ref>' and choose a section from that project.",
      );
    }
    return byId;
  }

  return fuzzyMatch(sections, trimmed, "Section");
}

// ── Project scope guard ──────────────────────────────────────────────

/**
 * Throws if a multi-homed task requires explicit project scope for an operation.
 */
export function requireProjectScope(task: AsanaTask, projectRef: string | undefined): void {
  if (projectRef || (task.projects ?? []).length <= 1) return;
  const candidates = (task.projects ?? [])
    .map((p) => `${p.name ?? p.gid} (id:${p.gid})`)
    .join(", ");
  sdkError(
    "Task is multi-homed; project scope required for this operation.",
    "MULTI_HOME_AMBIGUITY",
    `Add --project <ref>. Candidate projects: ${candidates}`,
  );
}
