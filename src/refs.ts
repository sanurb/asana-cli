import { api } from "./lib/http/http-json-client";
import { paginate } from "./lib/asana/paginate";
import { getDefaultWorkspaceGid } from "./lib/asana/workspace";
import { fatal } from "./output.ts";
import { type AsanaTask, type AsanaProject, TASK_OPT_FIELDS } from "./types.ts";

// ── URL Parsing ─────────────────────────────────────────────────────

const ASANA_TASK_URL = /^https?:\/\/app\.asana\.com\/(\d+)\/(\d+)\/(\d+)/;

function parseAsanaTaskUrl(url: string): string | null {
  return url.match(ASANA_TASK_URL)?.[3] ?? null;
}

// ── Ref Helpers ─────────────────────────────────────────────────────

function isIdRef(ref: string): boolean {
  return ref.startsWith("id:");
}

function extractId(ref: string): string {
  return ref.slice(3);
}

function looksLikeGid(ref: string): boolean {
  return /^\d+$/.test(ref.trim());
}

// ── Fuzzy Match ─────────────────────────────────────────────────────

function fuzzyMatch<T extends { name?: string; gid: string }>(
  items: T[],
  query: string,
  label: string,
): T {
  const lower = query.toLowerCase();
  const exact = items.filter((t) => t.name?.toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  const partial = items.filter((t) => t.name?.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    fatal(
      `Ambiguous ${label} "${query}". Matches:\n` +
        partial.slice(0, 5).map((t) => `  "${t.name}" (id:${t.gid})`).join("\n"),
      {
        code: "AMBIGUOUS_REF",
        fix: `Use the exact id: prefix to disambiguate, e.g. id:${partial[0].gid}`,
      },
    );
  }
  fatal(`${label} "${query}" not found.`, {
    code: "NOT_FOUND",
    fix: `Use a task name, Asana URL, or id:xxx. Run 'asana-cli search ${query}' to find matching tasks.`,
    nextActions: [
      { command: `asana-cli search <query>`, description: "Search for tasks by name", params: { query: { value: query, description: "Search term" } } },
      { command: "asana-cli inbox", description: "List all your incomplete tasks" },
    ],
  });
}

// ── Task Resolution ─────────────────────────────────────────────────

async function fetchTaskByGid(gid: string): Promise<AsanaTask> {
  const res = await api<AsanaTask>("GET", `/tasks/${gid}`, { query: { opt_fields: TASK_OPT_FIELDS } });
  return res.data;
}

/**
 * Resolves a task reference (name, URL, id:xxx, or raw GID) to an {@link AsanaTask}.
 */
export async function resolveTaskRef(ref: string): Promise<AsanaTask> {
  if (!ref.trim()) {
    fatal("Task reference cannot be empty.", {
      code: "INVALID_INPUT",
      fix: "Provide a task name, Asana URL, id:xxx, or numeric GID.",
    });
  }

  const taskGid = parseAsanaTaskUrl(ref);
  if (taskGid) return fetchTaskByGid(taskGid);

  if (isIdRef(ref)) return fetchTaskByGid(extractId(ref));

  if (looksLikeGid(ref)) {
    try {
      return await fetchTaskByGid(ref);
    } catch {
      /* fall through to search */
    }
  }

  const workspace = await getDefaultWorkspaceGid();
  const tasks = await paginate<AsanaTask>("/tasks", {
    assignee: "me",
    workspace,
    completed_since: "now",
    opt_fields: TASK_OPT_FIELDS,
    limit: 100,
  });

  return fuzzyMatch(tasks, ref, "Task");
}

// ── Project Resolution ──────────────────────────────────────────────

const PROJECT_OPT_FIELDS = "gid,name,workspace,archived";

/**
 * Resolves a project reference (name, id:xxx, or raw GID) to an {@link AsanaProject}.
 */
export async function resolveProjectRef(ref: string): Promise<AsanaProject> {
  if (!ref.trim()) {
    fatal("Project reference cannot be empty.", {
      code: "INVALID_INPUT",
      fix: "Provide a project name or id:xxx.",
    });
  }

  if (isIdRef(ref)) {
    const res = await api<AsanaProject>("GET", `/projects/${extractId(ref)}`, {
      query: { opt_fields: PROJECT_OPT_FIELDS },
    });
    return res.data;
  }

  if (looksLikeGid(ref)) {
    try {
      const res = await api<AsanaProject>("GET", `/projects/${ref}`, {
        query: { opt_fields: PROJECT_OPT_FIELDS },
      });
      return res.data;
    } catch {
      /* fall through */
    }
  }

  const workspace = await getDefaultWorkspaceGid();
  const projects = await paginate<AsanaProject>(`/workspaces/${workspace}/projects`, {
    opt_fields: PROJECT_OPT_FIELDS,
    archived: false,
    limit: 100,
  });

  return fuzzyMatch(projects, ref, "Project");
}
