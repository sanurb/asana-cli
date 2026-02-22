#!/usr/bin/env bun
/**
 * asana-cli — Agent-first Asana CLI
 *
 * HATEOAS JSON responses. Bearer token auth via env or agent-secrets.
 * Uses Asana Node SDK (node-asana). Ref resolution: name, URL, id:xxx, raw GID.
 *
 * Usage: asana-cli <command> [options]
 */

import { execSync } from "node:child_process";
import { ApiClient, TasksApi, ProjectsApi, SectionsApi, StoriesApi, UsersApi, TagsApi } from "asana";

// ── Types ───────────────────────────────────────────────────────────

type AsanaTask = {
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

type AsanaProject = {
  gid: string;
  name: string;
  workspace?: { gid: string; name?: string } | null;
  archived?: boolean;
};

type AsanaSection = {
  gid: string;
  name: string;
  project?: { gid: string } | null;
};

type AsanaStory = {
  gid: string;
  type?: string;
  text?: string;
  created_at?: string;
  created_by?: { gid: string; name?: string } | null;
};

type AsanaUser = {
  gid: string;
  name?: string;
  workspaces?: { gid: string; name?: string }[] | null;
};

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
    "No ASANA_ACCESS_TOKEN found. Set it via:\n" +
      "  export ASANA_ACCESS_TOKEN=<token>           # env var\n" +
      "  secrets add asana_access_token             # agent-secrets\n" +
      "Create a token at: https://app.asana.com/0/developer-console"
  );
}

// ── SDK client ──────────────────────────────────────────────────────

function getClient(): InstanceType<typeof ApiClient> {
  const client = ApiClient.instance;
  const token = (client as any).authentications["token"];
  token.accessToken = getToken();
  client.RETURN_COLLECTION = true;
  return client;
}

let _tasksApi: InstanceType<typeof TasksApi>;
let _projectsApi: InstanceType<typeof ProjectsApi>;
let _sectionsApi: InstanceType<typeof SectionsApi>;
let _storiesApi: InstanceType<typeof StoriesApi>;
let _usersApi: InstanceType<typeof UsersApi>;
let _tagsApi: InstanceType<typeof TagsApi>;

function tasksApi() { return _tasksApi ??= new TasksApi(getClient()); }
function projectsApi() { return _projectsApi ??= new ProjectsApi(getClient()); }
function sectionsApi() { return _sectionsApi ??= new SectionsApi(getClient()); }
function storiesApi() { return _storiesApi ??= new StoriesApi(getClient()); }
function usersApi() { return _usersApi ??= new UsersApi(getClient()); }
function tagsApi() { return _tagsApi ??= new TagsApi(getClient()); }

// ── Pagination helper ───────────────────────────────────────────────
// With RETURN_COLLECTION=true, list endpoints return a Collection with
// .data (current page items) and .nextPage() (returns next Collection or {data:null}).

async function collectAll<T>(collection: any): Promise<T[]> {
  const all: T[] = [];
  let page = collection;
  while (true) {
    if (!page.data) break;
    all.push(...page.data);
    page = await page.nextPage();
  }
  return all;
}

// ── Output (HATEOAS) ────────────────────────────────────────────────

function ok(
  command: string,
  result: unknown,
  nextActions?: { command: string; description: string }[]
) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        command: `asana-cli ${command}`,
        result,
        ...(nextActions ? { next_actions: nextActions } : {}),
      },
      null,
      2
    )
  );
}

function fatal(message: string): never {
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
  throw new Error("unreachable");
}

// ── Common opt_fields ───────────────────────────────────────────────

const TASK_OPT_FIELDS = [
  "gid", "name", "notes", "completed", "due_on", "due_at",
  "assignee", "assignee.name", "workspace", "workspace.name",
  "projects", "projects.name", "memberships", "memberships.project",
  "memberships.section", "parent", "permalink_url", "tags", "tags.name",
].join(",");

const STORY_OPT_FIELDS = "gid,type,text,created_at,created_by,created_by.name";

// ── Default workspace ──────────────────────────────────────────────

let cachedWorkspaceGid: string | null = null;

async function getDefaultWorkspaceGid(): Promise<string> {
  if (cachedWorkspaceGid) return cachedWorkspaceGid;
  const res = await usersApi().getUser("me", {
    opt_fields: "workspaces,workspaces.gid,workspaces.name",
  });
  const workspaces = res.data?.workspaces ?? [];
  if (workspaces.length === 0) fatal("No workspaces found for the authenticated user.");
  cachedWorkspaceGid = workspaces[0].gid;
  return cachedWorkspaceGid;
}

// ── Ref resolution ─────────────────────────────────────────────────
// Asana URLs: https://app.asana.com/0/<project_gid>/<task_gid> or /0/0/<task_gid>

const ASANA_TASK_URL = /^https?:\/\/app\.asana\.com\/(\d+)\/(\d+)\/(\d+)/;

function parseAsanaTaskUrl(url: string): string | null {
  const m = url.match(ASANA_TASK_URL);
  if (!m) return null;
  return m[3]; // task gid is last segment
}

function isIdRef(ref: string): boolean {
  return ref.startsWith("id:");
}
function extractId(ref: string): string {
  return ref.slice(3);
}
function looksLikeGid(ref: string): boolean {
  return /^\d+$/.test(ref.trim());
}

async function fetchTaskByGid(gid: string): Promise<AsanaTask> {
  const res = await tasksApi().getTask(gid, { opt_fields: TASK_OPT_FIELDS });
  return res.data;
}

async function resolveTaskRef(ref: string): Promise<AsanaTask> {
  if (!ref.trim()) fatal("Task reference cannot be empty.");

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
  const tasks = await collectAll<AsanaTask>(
    await tasksApi().getTasks({
      assignee: "me",
      workspace,
      completed_since: "now",
      opt_fields: TASK_OPT_FIELDS,
      limit: 100,
    })
  );

  const lower = ref.toLowerCase();
  const exact = tasks.filter((t) => t.name?.toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  const partial = tasks.filter((t) => t.name?.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    fatal(
      `Ambiguous task "${ref}". Matches:\n` +
        partial.slice(0, 5).map((t) => `  "${t.name}" (id:${t.gid})`).join("\n")
    );
  }

  fatal(`Task "${ref}" not found. Use a name, Asana URL, or id:xxx.`);
}

async function resolveProjectRef(ref: string): Promise<AsanaProject> {
  if (!ref.trim()) fatal("Project reference cannot be empty.");

  const projectOpts = { opt_fields: "gid,name,workspace,archived" };

  if (isIdRef(ref)) {
    const res = await projectsApi().getProject(extractId(ref), projectOpts);
    return res.data;
  }

  if (looksLikeGid(ref)) {
    try {
      const res = await projectsApi().getProject(ref, projectOpts);
      return res.data;
    } catch {
      /* fall through */
    }
  }

  const workspace = await getDefaultWorkspaceGid();
  const projects = await collectAll<AsanaProject>(
    await projectsApi().getProjectsForWorkspace(workspace, {
      opt_fields: "gid,name,workspace,archived",
      archived: false,
      limit: 100,
    })
  );
  const lower = ref.toLowerCase();
  const exact = projects.filter((p) => p.name?.toLowerCase() === lower);
  if (exact.length === 1) return exact[0];
  const partial = projects.filter((p) => p.name?.toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  if (partial.length > 1) {
    fatal(
      `Ambiguous project "${ref}". Matches:\n` +
        partial.slice(0, 5).map((p) => `  "${p.name}" (id:${p.gid})`).join("\n")
    );
  }

  fatal(`Project "${ref}" not found. Use a name or id:xxx.`);
}

// ── Formatting ──────────────────────────────────────────────────────

function formatTask(t: AsanaTask) {
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

function formatStory(s: AsanaStory) {
  return {
    id: s.gid,
    type: s.type,
    text: s.text,
    created_at: s.created_at,
    created_by: s.created_by?.name ?? s.created_by?.gid ?? undefined,
  };
}

// ── Task commands ───────────────────────────────────────────────────

async function cmdToday() {
  const workspace = await getDefaultWorkspaceGid();
  const today = new Date().toISOString().slice(0, 10);
  const tasks = await collectAll<AsanaTask>(
    await tasksApi().getTasks({
      assignee: "me",
      workspace,
      opt_fields: TASK_OPT_FIELDS,
      limit: 100,
    })
  );
  const dueToday = tasks.filter((t) => t.due_on === today && !t.completed);
  const overdue = tasks.filter((t) => t.due_on && t.due_on < today && !t.completed);

  ok(
    "today",
    {
      count: dueToday.length,
      overdue_count: overdue.length,
      tasks: dueToday.map(formatTask),
      overdue: overdue.map(formatTask),
    },
    [
      { command: "asana-cli inbox", description: "Check My Tasks" },
      { command: "asana-cli complete <ref>", description: "Complete a task" },
    ]
  );
}

async function cmdInbox() {
  const workspace = await getDefaultWorkspaceGid();
  const tasks = await collectAll<AsanaTask>(
    await tasksApi().getTasks({
      assignee: "me",
      workspace,
      completed_since: "now",
      opt_fields: TASK_OPT_FIELDS,
      limit: 100,
    })
  );
  const inbox = tasks.filter((t) => !t.completed);

  ok(
    "inbox",
    {
      count: inbox.length,
      workspace,
      tasks: inbox.map(formatTask),
    },
    [
      { command: "asana-cli add 'Task name'", description: "Add a task" },
      { command: "asana-cli complete <ref>", description: "Complete a task" },
    ]
  );
}

async function cmdSearch(query: string) {
  const workspace = await getDefaultWorkspaceGid();
  const allTasks = await collectAll<AsanaTask>(
    await tasksApi().getTasks({
      assignee: "me",
      workspace,
      completed_since: "now",
      opt_fields: TASK_OPT_FIELDS,
      limit: 100,
    })
  );
  const lower = query.toLowerCase();
  const tasks = allTasks.filter((t) => t.name?.toLowerCase().includes(lower)).slice(0, 50);

  ok(
    "search",
    {
      query,
      count: tasks.length,
      tasks: tasks.map(formatTask),
    },
    [
      { command: "asana-cli show <ref>", description: "Show task details and comments" },
      { command: "asana-cli complete <ref>", description: "Complete a task" },
    ]
  );
}

async function cmdList(opts: { project?: string; section?: string }) {
  let tasks: AsanaTask[];

  if (opts.project) {
    const project = await resolveProjectRef(opts.project);
    const queryOpts: Record<string, any> = {
      project: project.gid,
      opt_fields: TASK_OPT_FIELDS,
      limit: 100,
    };
    if (opts.section) queryOpts.section = opts.section;
    tasks = await collectAll<AsanaTask>(await tasksApi().getTasks(queryOpts));
  } else {
    const workspace = await getDefaultWorkspaceGid();
    tasks = await collectAll<AsanaTask>(
      await tasksApi().getTasks({
        assignee: "me",
        workspace,
        completed_since: "now",
        opt_fields: TASK_OPT_FIELDS,
        limit: 100,
      })
    );
  }

  ok("list", {
    filter: opts.project ? `project: ${opts.project}` : "assignee: me",
    count: tasks.length,
    tasks: tasks.map(formatTask),
  });
}

async function cmdShow(ref: string) {
  const task = await resolveTaskRef(ref);
  const stories = await collectAll<AsanaStory>(
    await storiesApi().getStoriesForTask(task.gid, {
      opt_fields: STORY_OPT_FIELDS,
      limit: 100,
    })
  );

  ok(
    "show",
    {
      ...formatTask(task),
      notes: task.notes || undefined,
      comments: stories.map(formatStory),
    },
    [
      { command: `asana-cli comment-add ${task.gid} --content 'text'`, description: "Add a comment" },
      { command: `asana-cli complete ${task.gid}`, description: "Complete this task" },
    ]
  );
}

interface AddOpts {
  description?: string;
  project?: string;
  section?: string;
  parent?: string;
  due?: string;
  due_on?: string;
  tags?: string;
}

async function cmdAdd(name: string, opts: AddOpts) {
  const workspace = await getDefaultWorkspaceGid();
  const data: Record<string, unknown> = {
    name,
    workspace,
    completed: false,
  };

  if (opts.description) data.notes = opts.description;
  if (opts.due) data.due_on = opts.due;
  if (opts.due_on) data.due_on = opts.due_on;
  if (opts.parent) data.parent = opts.parent;
  if (opts.tags) {
    const tagGids = opts.tags.split(",").map((s) => s.trim());
    data.tags = tagGids;
  }

  if (opts.project) {
    const project = await resolveProjectRef(opts.project);
    data.projects = [project.gid];
    if (opts.section) data.section = opts.section;
  } else {
    data.assignee = "me";
  }

  const res = await tasksApi().createTask({ data });

  ok("add", formatTask(res.data), [
    { command: `asana-cli complete ${res.data.gid}`, description: "Complete this task" },
    { command: "asana-cli today", description: "View today's tasks" },
  ]);
}

async function cmdComplete(ref: string) {
  const task = await resolveTaskRef(ref);
  await tasksApi().updateTask({ data: { completed: true } }, task.gid);
  ok(
    "complete",
    { completed: formatTask(task) },
    [{ command: "asana-cli today", description: "View remaining today tasks" }]
  );
}

async function cmdReopen(ref: string) {
  const task = await resolveTaskRef(ref);
  await tasksApi().updateTask({ data: { completed: false } }, task.gid);
  ok("reopen", { task: formatTask(task) });
}

async function cmdDelete(ref: string) {
  const task = await resolveTaskRef(ref);
  await tasksApi().deleteTask(task.gid);
  ok("delete", {
    deleted: { id: task.gid, name: task.name },
  });
}

interface UpdateOpts {
  name?: string;
  description?: string;
  due?: string;
  due_on?: string;
  tags?: string;
}

async function cmdUpdate(ref: string, opts: UpdateOpts) {
  const task = await resolveTaskRef(ref);
  const data: Record<string, unknown> = {};
  if (opts.name) data.name = opts.name;
  if (opts.description !== undefined) data.notes = opts.description;
  if (opts.due) data.due_on = opts.due;
  if (opts.due_on) data.due_on = opts.due_on;
  if (opts.tags) data.tags = opts.tags.split(",").map((s) => s.trim());

  const res = await tasksApi().updateTask({ data }, task.gid);
  ok("update", formatTask(res.data));
}

async function cmdMove(ref: string, opts: { project?: string; section?: string; parent?: string }) {
  const task = await resolveTaskRef(ref);
  const data: Record<string, unknown> = {};
  if (opts.project) {
    const project = await resolveProjectRef(opts.project);
    data.projects = [project.gid];
    if (opts.section) data.section = opts.section;
  }
  if (opts.parent) data.parent = opts.parent;

  const res = await tasksApi().updateTask({ data }, task.gid);
  ok("move", formatTask(res.data));
}

// ── Comment (Stories) commands ──────────────────────────────────────

async function cmdComments(ref: string) {
  const task = await resolveTaskRef(ref);
  const stories = await collectAll<AsanaStory>(
    await storiesApi().getStoriesForTask(task.gid, {
      opt_fields: STORY_OPT_FIELDS,
      limit: 100,
    })
  );

  ok(
    "comments",
    {
      taskId: task.gid,
      taskName: task.name,
      count: stories.length,
      comments: stories.map(formatStory),
    },
    [{ command: `asana-cli comment-add ${task.gid} --content 'text'`, description: "Add a comment" }]
  );
}

async function cmdCommentAdd(ref: string, opts: { content: string }) {
  const task = await resolveTaskRef(ref);
  const res = await storiesApi().createStoryForTask({ data: { text: opts.content } }, task.gid);
  ok(
    "comment-add",
    {
      task: { id: task.gid, name: task.name },
      comment: formatStory(res.data),
    },
    [{ command: `asana-cli comments ${task.gid}`, description: "View all comments on this task" }]
  );
}

// ── Organization commands ──────────────────────────────────────────

async function cmdProjects() {
  const workspace = await getDefaultWorkspaceGid();
  const projects = await collectAll<AsanaProject>(
    await projectsApi().getProjectsForWorkspace(workspace, {
      opt_fields: "gid,name,workspace,archived",
      archived: false,
      limit: 100,
    })
  );

  ok(
    "projects",
    {
      count: projects.length,
      workspace,
      projects: projects.map((p) => ({
        id: p.gid,
        name: p.name,
        workspace: p.workspace?.name ?? p.workspace?.gid,
        archived: p.archived ?? false,
      })),
    },
    [{ command: "asana-cli list --project <name>", description: "List tasks in a project" }]
  );
}

async function cmdSections(projectRef?: string) {
  if (!projectRef) {
    fatal("Usage: asana-cli sections --project <name>");
  }
  const project = await resolveProjectRef(projectRef);
  const sections = await collectAll<AsanaSection>(
    await sectionsApi().getSectionsForProject(project.gid, {
      opt_fields: "gid,name,project",
      limit: 100,
    })
  );

  ok("sections", {
    count: sections.length,
    projectId: project.gid,
    projectName: project.name,
    sections: sections.map((s) => ({
      id: s.gid,
      name: s.name,
      projectId: s.project?.gid,
    })),
  });
}

async function cmdTags() {
  const workspace = await getDefaultWorkspaceGid();
  const tags = await collectAll<{ gid: string; name?: string }>(
    await tagsApi().getTagsForWorkspace(workspace, {
      opt_fields: "gid,name",
      limit: 100,
    })
  );

  ok("tags", {
    count: tags.length,
    tags: tags.map((t) => ({ id: t.gid, name: t.name ?? t.gid })),
  });
}

async function cmdAddProject(name: string) {
  const workspace = await getDefaultWorkspaceGid();
  const res = await projectsApi().createProject({ data: { name, workspace } });
  ok("add-project", {
    id: res.data.gid,
    name: res.data.name,
    workspace: res.data.workspace?.gid,
  });
}

async function cmdAddSection(name: string, projectRef: string) {
  const project = await resolveProjectRef(projectRef);
  const res = await sectionsApi().createSectionForProject(project.gid, {
    body: { data: { name } },
  });
  ok("add-section", {
    id: res.data.gid,
    name: res.data.name,
    projectId: project.gid,
  });
}

// ── Review (dashboard) ─────────────────────────────────────────────

async function cmdReview() {
  const workspace = await getDefaultWorkspaceGid();
  const today = new Date().toISOString().slice(0, 10);

  const [allTasks, projects] = await Promise.all([
    collectAll<AsanaTask>(
      await tasksApi().getTasks({
        assignee: "me",
        workspace,
        completed_since: "now",
        opt_fields: TASK_OPT_FIELDS,
        limit: 100,
      })
    ),
    collectAll<AsanaProject>(
      await projectsApi().getProjectsForWorkspace(workspace, {
        opt_fields: "gid,name",
        archived: false,
        limit: 100,
      })
    ),
  ]);

  const incomplete = allTasks.filter((t) => !t.completed);
  const todayTasks = incomplete.filter((t) => t.due_on === today);
  const overdue = incomplete.filter((t) => t.due_on && t.due_on < today);
  const noDue = incomplete.filter((t) => !t.due_on);

  ok(
    "review",
    {
      today: { count: todayTasks.length, tasks: todayTasks.map(formatTask) },
      inbox: { count: incomplete.length, tasks: incomplete.slice(0, 20).map(formatTask) },
      overdue: { count: overdue.length, tasks: overdue.map(formatTask) },
      floating: { count: noDue.length },
      projects: projects.map((p) => ({
        id: p.gid,
        name: p.name,
        taskCount: allTasks.filter((t) => t.projects?.some((pr) => pr.gid === p.gid)).length,
      })),
      total: incomplete.length,
    },
    [
      { command: "asana-cli inbox", description: "Process My Tasks" },
      { command: "asana-cli complete <ref>", description: "Complete a task" },
      { command: "asana-cli add 'task' --due_on " + today, description: "Add a task for today" },
    ]
  );
}

// ── Completed ───────────────────────────────────────────────────────

async function cmdCompleted(opts: { since?: string; project?: string; limit?: string }) {
  const workspace = await getDefaultWorkspaceGid();
  const limit = opts.limit ? parseInt(opts.limit, 10) : 20;
  const allTasks = await collectAll<AsanaTask>(
    await tasksApi().getTasks({
      assignee: "me",
      workspace,
      completed_since: opts.since ?? "2020-01-01",
      opt_fields: "gid,name,completed,completed_at,due_on,projects",
      limit: 100,
    })
  );
  const tasks = allTasks.filter((t) => t.completed).slice(0, limit);

  let filtered = tasks;
  if (opts.project) {
    const project = await resolveProjectRef(opts.project);
    filtered = tasks.filter((t) => t.projects?.some((p) => p.gid === project.gid));
  }

  ok("completed", {
    count: filtered.length,
    tasks: filtered.map((t) => ({
      id: t.gid,
      name: t.name,
      completed: t.completed,
      projectIds: t.projects?.map((p) => p.gid) ?? [],
    })),
  });
}

// ── CLI parser ─────────────────────────────────────────────────────

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = "true";
      }
    }
  }
  return flags;
}

function getNonFlagArgs(args: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      if (args[i + 1] && !args[i + 1].startsWith("--")) i++;
      continue;
    }
    result.push(args[i]);
  }
  return result;
}

function usage(): never {
  ok("help", {
    version: "0.1.0",
    auth: "ASANA_ACCESS_TOKEN env var or 'secrets lease asana_access_token'",
    notes: [
      "All <ref> args accept: task name, Asana URL, id:xxx, or raw GID",
      "Project args (--project) accept project name or GID",
      "Asana uses workspaces; default workspace = first in user's list",
    ],
    commands: {
      today: "Tasks due today + overdue (assignee: me)",
      inbox: "My Tasks (incomplete, assignee: me)",
      "search <query>": "Search tasks in workspace (premium: full-text)",
      "list [--project NAME] [--section GID]": "List tasks",
      "show <ref>": "Task detail + comments (stories)",
      "add 'name' [--due_on YYYY-MM-DD] [--project NAME] [--section GID] [--parent GID] [--tags a,b] [--description X]": "Create a task",
      "complete <ref>": "Complete a task",
      "reopen <ref>": "Reopen a completed task",
      "update <ref> [--name X] [--due_on YYYY-MM-DD] [--tags a,b] [--description X]": "Update a task",
      "move <ref> --project NAME [--section GID] | --parent GID": "Move a task",
      "delete <ref>": "Delete a task",
      "comments <ref>": "List comments (stories) on a task",
      "comment-add <ref> --content 'text'": "Add a comment",
      "review": "Dashboard: today, inbox, overdue, projects",
      "completed [--since YYYY-MM-DD] [--project NAME] [--limit N]": "Completed tasks",
      projects: "List all projects in default workspace",
      "sections --project NAME": "List sections in a project",
      tags: "List all tags in workspace",
      "add-project 'name'": "Create a project",
      "add-section 'name' --project NAME": "Create a section",
    },
  });
  process.exit(0);
  throw new Error("unreachable");
}

// ── Main ───────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();

  const cmd = args[0];
  const rest = args.slice(1);
  const flags = parseFlags(rest);
  const pos = getNonFlagArgs(rest);

  try {
    switch (cmd) {
      case "today":
        return await cmdToday();
      case "inbox":
        return await cmdInbox();
      case "search":
        if (!pos[0]) fatal("Usage: asana-cli search <query>");
        return await cmdSearch(pos[0]);
      case "list":
        return await cmdList({ project: flags.project, section: flags.section });
      case "review":
        return await cmdReview();
      case "show":
        if (!pos[0]) fatal("Usage: asana-cli show <ref>");
        return await cmdShow(pos[0]);
      case "add":
        if (!pos[0]) fatal("Usage: asana-cli add 'name' [--due_on X] [--project NAME] ...");
        return await cmdAdd(pos[0], {
          description: flags.description,
          project: flags.project,
          section: flags.section,
          parent: flags.parent,
          due: flags.due ?? flags.due_on,
          due_on: flags.due_on,
          tags: flags.tags,
        });
      case "complete":
        if (!pos[0]) fatal("Usage: asana-cli complete <ref>");
        return await cmdComplete(pos[0]);
      case "reopen":
        if (!pos[0]) fatal("Usage: asana-cli reopen <ref>");
        return await cmdReopen(pos[0]);
      case "update":
        if (!pos[0]) fatal("Usage: asana-cli update <ref> [--name X] ...");
        return await cmdUpdate(pos[0], {
          name: flags.name ?? flags.content,
          description: flags.description,
          due: flags.due ?? flags.due_on,
          due_on: flags.due_on,
          tags: flags.tags,
        });
      case "move":
        if (!pos[0]) fatal("Usage: asana-cli move <ref> --project NAME | --section GID | --parent GID");
        return await cmdMove(pos[0], {
          project: flags.project,
          section: flags.section,
          parent: flags.parent,
        });
      case "delete":
        if (!pos[0]) fatal("Usage: asana-cli delete <ref>");
        return await cmdDelete(pos[0]);

      case "comments":
        if (!pos[0]) fatal("Usage: asana-cli comments <ref>");
        return await cmdComments(pos[0]);
      case "comment-add":
        if (!pos[0] || !flags.content) fatal("Usage: asana-cli comment-add <ref> --content 'text'");
        return await cmdCommentAdd(pos[0], { content: flags.content });

      case "completed":
        return await cmdCompleted({
          since: flags.since,
          project: flags.project,
          limit: flags.limit,
        });

      case "projects":
        return await cmdProjects();
      case "sections":
        return await cmdSections(flags.project);
      case "tags":
        return await cmdTags();
      case "add-project":
        if (!pos[0]) fatal("Usage: asana-cli add-project 'name'");
        return await cmdAddProject(pos[0]);
      case "add-section":
        if (!pos[0] || !flags.project) fatal("Usage: asana-cli add-section 'name' --project NAME");
        return await cmdAddSection(pos[0], flags.project);

      case "help":
      case "--help":
      case "-h":
        return usage();
      default:
        fatal(`Unknown command: ${cmd}. Run 'asana-cli help' for usage.`);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    fatal(`${cmd} failed: ${message}`);
  }
}

main();
