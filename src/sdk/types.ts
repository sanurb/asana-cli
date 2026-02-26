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
  dependencies?: { gid: string; name?: string }[] | null;
  dependents?: { gid: string; name?: string }[] | null;
  custom_fields?: { gid: string; name?: string; resource_subtype?: string; display_value?: string | null }[] | null;
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
  email?: string;
  workspaces?: { gid: string; name?: string }[] | null;
};

export type AsanaTag = {
  gid: string;
  name?: string;
};

export type AsanaWorkspace = {
  readonly gid: string;
  readonly name?: string;
  readonly is_default?: boolean;
};

export type AsanaAttachment = {
  gid: string;
  name?: string;
  resource_subtype?: string;
  host?: string;
  permanent_url?: string | null;
  download_url?: string | null;
  view_url?: string | null;
  created_at?: string;
  created_by?: { gid: string; name?: string } | null;
};

export type AsanaCustomFieldDefinition = {
  readonly gid: string;
  readonly name: string;
  readonly resource_subtype?: string;
  readonly type?: string;
  readonly enum_options?: readonly { readonly gid: string; readonly name?: string }[];
};

// ── opt_fields constants ────────────────────────────────────────────

export const TASK_OPT_FIELDS = [
  "gid", "name", "notes", "completed", "due_on", "due_at",
  "assignee", "assignee.name", "workspace", "workspace.name",
  "projects", "projects.name", "memberships", "memberships.project",
  "memberships.section", "parent", "permalink_url", "tags", "tags.name",
  "assignee.gid", "dependencies", "dependencies.name", "dependents",
  "dependents.name", "custom_fields", "custom_fields.name",
  "custom_fields.display_value", "custom_fields.resource_subtype",
  "num_subtasks",
].join(",");

export const STORY_OPT_FIELDS = "gid,type,text,created_at,created_by,created_by.name";

export const PROJECT_OPT_FIELDS = "gid,name,workspace,archived";
