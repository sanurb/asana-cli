// ── Asana API Types ─────────────────────────────────────────────────

export type AsanaTask = {
  gid: string;
  name: string;
  notes?: string | null;
  completed?: boolean;
  due_on?: string | null;
  due_at?: string | null;
  assignee?: { gid: string; name?: string } | null;
  workspace?: { gid: string; name?: string } | null;
  projects?: { gid: string; name?: string }[] | null;
  memberships?: { project: { gid: string; name?: string }; section: { gid: string; name?: string } }[] | null;
  parent?: { gid: string; name?: string } | null;
  permalink_url?: string | null;
  num_subtasks?: number;
  tags?: { gid: string; name?: string }[] | null;
};

export type AsanaProject = {
  gid: string;
  name: string;
  workspace?: { gid: string; name?: string } | null;
  archived?: boolean;
};

export type AsanaSection = {
  gid: string;
  name: string;
  project?: { gid: string } | null;
};

export type AsanaStory = {
  gid: string;
  type?: string;
  text?: string;
  created_at?: string;
  created_by?: { gid: string; name?: string } | null;
};

export type AsanaUser = {
  gid: string;
  name?: string;
  workspaces?: { gid: string; name?: string }[] | null;
};

export type AsanaTag = {
  gid: string;
  name?: string;
};

// ── opt_fields constants ────────────────────────────────────────────

export const TASK_OPT_FIELDS = [
  "gid", "name", "notes", "completed", "due_on", "due_at",
  "assignee", "assignee.name", "workspace", "workspace.name",
  "projects", "projects.name", "memberships", "memberships.project",
  "memberships.section", "parent", "permalink_url", "tags", "tags.name",
].join(",");

export const STORY_OPT_FIELDS = "gid,type,text,created_at,created_by,created_by.name";

// ── Formatters ──────────────────────────────────────────────────────

export function formatTask(t: AsanaTask) {
  return {
    id: t.gid,
    name: t.name,
    notes: t.notes || undefined,
    completed: t.completed ?? false,
    due_on: t.due_on ?? null,
    due_at: t.due_at ?? null,
    assignee: t.assignee?.name ?? t.assignee?.gid ?? undefined,
    projectIds: t.projects?.map((p) => p.gid) ?? [],
    projectNames: t.projects?.map((p) => p.name) ?? undefined,
    section: t.memberships?.[0]?.section?.name ?? undefined,
    parentId: t.parent?.gid ?? undefined,
    permalink_url: t.permalink_url ?? undefined,
    tags: t.tags?.map((x) => x.name ?? x.gid) ?? undefined,
  };
}

export function formatStory(s: AsanaStory) {
  return {
    id: s.gid,
    type: s.type,
    text: s.text,
    created_at: s.created_at,
    created_by: s.created_by?.name ?? s.created_by?.gid ?? undefined,
  };
}
