import { define } from "gunshi";
import { paginate } from "../lib/asana/paginate";
import { getDefaultWorkspaceGid } from "../lib/asana/workspace";
import { ok, truncate } from "../output.ts";
import { resolveTaskRef, resolveProjectRef } from "../refs.ts";
import {
  type AsanaTask,
  type AsanaStory,
  type AsanaProject,
  TASK_OPT_FIELDS,
  STORY_OPT_FIELDS,
  formatTask,
  formatStory,
} from "../types.ts";

// ── today ───────────────────────────────────────────────────────────

export const today = define({
  name: "today",
  description: "Tasks due today + overdue (assignee: me)",
  args: {},
  run: async () => {
    const workspace = await getDefaultWorkspaceGid();
    const todayStr = new Date().toISOString().slice(0, 10);
    const tasks = await paginate<AsanaTask>("/tasks", {
      assignee: "me",
      workspace,
      completed_since: "now",
      opt_fields: TASK_OPT_FIELDS,
      limit: 100,
    });
    const dueToday = tasks.filter((t) => t.due_on === todayStr);
    const overdue = tasks.filter((t) => t.due_on && t.due_on < todayStr);

    ok("today", {
      count: dueToday.length,
      overdue_count: overdue.length,
      tasks: dueToday.map(formatTask),
      overdue: overdue.map(formatTask),
    }, [
      { command: "asana-cli inbox", description: "Check all incomplete tasks" },
      {
        command: "asana-cli complete <ref>",
        description: "Complete a task",
        params: { ref: { required: true, description: "Task name, URL, id:xxx, or GID" } },
      },
      {
        command: "asana-cli show <ref>",
        description: "View task details",
        params: { ref: { required: true, description: "Task name, URL, id:xxx, or GID" } },
      },
    ]);
  },
});

// ── inbox ───────────────────────────────────────────────────────────

export const inbox = define({
  name: "inbox",
  description: "My Tasks — incomplete, assigned to me",
  args: {},
  run: async () => {
    const workspace = await getDefaultWorkspaceGid();
    const tasks = await paginate<AsanaTask>("/tasks", {
      assignee: "me",
      workspace,
      completed_since: "now",
      opt_fields: TASK_OPT_FIELDS,
      limit: 100,
    });
    const { items, meta } = truncate(tasks.map(formatTask));

    ok("inbox", {
      ...meta,
      workspace,
      tasks: items,
    }, [
      {
        command: "asana-cli add <name>",
        description: "Add a new task",
        params: { name: { required: true, description: "Task name" } },
      },
      {
        command: "asana-cli complete <ref>",
        description: "Complete a task",
        params: { ref: { required: true, description: "Task name, URL, id:xxx, or GID" } },
      },
      {
        command: "asana-cli show <ref>",
        description: "View task details",
        params: { ref: { required: true, description: "Task name, URL, id:xxx, or GID" } },
      },
    ]);
  },
});

// ── search ──────────────────────────────────────────────────────────

export const search = define({
  name: "search",
  description: "Search tasks by name in workspace",
  args: {
    query: {
      type: "positional" as const,
      description: "Search query",
      required: true,
    },
  },
  run: async (ctx) => {
    const query = ctx.values.query as string;
    const workspace = await getDefaultWorkspaceGid();
    const allTasks = await paginate<AsanaTask>("/tasks", {
      assignee: "me",
      workspace,
      completed_since: "now",
      opt_fields: TASK_OPT_FIELDS,
      limit: 100,
    });
    const lower = query.toLowerCase();
    const matched = allTasks.filter((t) => t.name?.toLowerCase().includes(lower));
    const { items, meta } = truncate(matched.map(formatTask));

    ok("search", {
      query,
      ...meta,
      tasks: items,
    }, [
      {
        command: "asana-cli show <ref>",
        description: "Show task details and comments",
        params: { ref: { required: true, description: "Task name, URL, id:xxx, or GID" } },
      },
      {
        command: "asana-cli complete <ref>",
        description: "Complete a task",
        params: { ref: { required: true, description: "Task name, URL, id:xxx, or GID" } },
      },
    ]);
  },
});

// ── list ─────────────────────────────────────────────────────────────

export const list = define({
  name: "list",
  description: "List tasks (by project or assignee: me)",
  args: {
    project: {
      type: "string" as const,
      description: "Project name or GID",
      short: "p",
    },
    section: {
      type: "string" as const,
      description: "Section GID",
      short: "s",
    },
  },
  run: async (ctx) => {
    const { project, section } = ctx.values;
    let tasks: AsanaTask[];

    if (project) {
      const proj = await resolveProjectRef(project);
      tasks = await paginate<AsanaTask>("/tasks", {
        project: proj.gid,
        opt_fields: TASK_OPT_FIELDS,
        limit: 100,
        ...(section ? { section } : {}),
      });
    } else {
      const workspace = await getDefaultWorkspaceGid();
      tasks = await paginate<AsanaTask>("/tasks", {
        assignee: "me",
        workspace,
        completed_since: "now",
        opt_fields: TASK_OPT_FIELDS,
        limit: 100,
      });
    }

    const { items, meta } = truncate(tasks.map(formatTask));

    ok("list", {
      filter: project ? `project: ${project}` : "assignee: me",
      ...meta,
      tasks: items,
    }, [
      {
        command: "asana-cli show <ref>",
        description: "View task details",
        params: { ref: { required: true, description: "Task name, URL, id:xxx, or GID" } },
      },
      {
        command: "asana-cli complete <ref>",
        description: "Complete a task",
        params: { ref: { required: true, description: "Task name, URL, id:xxx, or GID" } },
      },
      {
        command: "asana-cli add <name> [--project <project>]",
        description: "Add a task",
        params: {
          name: { required: true, description: "Task name" },
          project: { value: project ?? undefined, description: "Project name or GID" },
        },
      },
    ]);
  },
});

// ── show ─────────────────────────────────────────────────────────────

export const show = define({
  name: "show",
  description: "Task detail + comments (stories)",
  args: {
    ref: {
      type: "positional" as const,
      description: "Task reference (name, URL, id:xxx, or GID)",
      required: true,
    },
  },
  run: async (ctx) => {
    const ref = ctx.values.ref as string;
    const task = await resolveTaskRef(ref);
    const stories = await paginate<AsanaStory>(`/tasks/${task.gid}/stories`, {
      opt_fields: STORY_OPT_FIELDS,
      limit: 100,
    });
    const { items: commentItems, meta } = truncate(stories.map(formatStory));

    ok("show", {
      ...formatTask(task),
      notes: task.notes || undefined,
      comments: commentItems,
      comments_truncated: meta.truncated,
      comments_total: meta.total,
    }, [
      {
        command: "asana-cli comment-add <ref> --content <text>",
        description: "Add a comment",
        params: {
          ref: { value: task.gid, description: "Task GID" },
          text: { required: true, description: "Comment text" },
        },
      },
      {
        command: "asana-cli complete <ref>",
        description: "Complete this task",
        params: { ref: { value: task.gid, description: "Task GID" } },
      },
      {
        command: "asana-cli update <ref> [--name <name>] [--due_on <date>]",
        description: "Update this task",
        params: { ref: { value: task.gid, description: "Task GID" } },
      },
    ]);
  },
});

// ── review ───────────────────────────────────────────────────────────

export const review = define({
  name: "review",
  description: "Dashboard: today, inbox, overdue, projects",
  args: {},
  run: async () => {
    const workspace = await getDefaultWorkspaceGid();
    const todayStr = new Date().toISOString().slice(0, 10);

    const [allTasks, projectsList] = await Promise.all([
      paginate<AsanaTask>("/tasks", {
        assignee: "me",
        workspace,
        completed_since: "now",
        opt_fields: TASK_OPT_FIELDS,
        limit: 100,
      }),
      paginate<AsanaProject>(`/workspaces/${workspace}/projects`, {
        opt_fields: "gid,name",
        archived: false,
        limit: 100,
      }),
    ]);

    const incomplete = allTasks.filter((t) => !t.completed);
    const todayTasks = incomplete.filter((t) => t.due_on === todayStr);
    const overdue = incomplete.filter((t) => t.due_on && t.due_on < todayStr);
    const noDue = incomplete.filter((t) => !t.due_on);

    // Pre-compute task counts per project (O(tasks) instead of O(tasks * projects))
    const projectTaskCounts = new Map<string, number>();
    for (const t of allTasks) {
      for (const p of t.projects ?? []) {
        projectTaskCounts.set(p.gid, (projectTaskCounts.get(p.gid) ?? 0) + 1);
      }
    }

    ok("review", {
      today: { count: todayTasks.length, tasks: todayTasks.map(formatTask) },
      inbox: { count: incomplete.length, tasks: truncate(incomplete.map(formatTask), 20).items },
      overdue: { count: overdue.length, tasks: overdue.map(formatTask) },
      floating: { count: noDue.length },
      projects: projectsList.map((p) => ({
        id: p.gid,
        name: p.name,
        taskCount: projectTaskCounts.get(p.gid) ?? 0,
      })),
      total: incomplete.length,
    }, [
      { command: "asana-cli inbox", description: "Process My Tasks" },
      {
        command: "asana-cli complete <ref>",
        description: "Complete a task",
        params: { ref: { required: true, description: "Task name, URL, id:xxx, or GID" } },
      },
      {
        command: "asana-cli add <name> [--due_on <date>]",
        description: "Add a task for today",
        params: {
          name: { required: true, description: "Task name" },
          date: { default: todayStr, description: "Due date (YYYY-MM-DD)" },
        },
      },
    ]);
  },
});

// ── completed ────────────────────────────────────────────────────────

export const completed = define({
  name: "completed",
  description: "List completed tasks",
  args: {
    since: {
      type: "string" as const,
      description: "Completed since date (YYYY-MM-DD)",
    },
    project: {
      type: "string" as const,
      description: "Filter by project name or GID",
      short: "p",
    },
    limit: {
      type: "number" as const,
      description: "Max results",
      default: 20,
    },
  },
  run: async (ctx) => {
    const { since, project, limit: maxResults } = ctx.values;
    const workspace = await getDefaultWorkspaceGid();
    const allTasks = await paginate<AsanaTask>(
      "/tasks",
      {
        assignee: "me",
        workspace,
        completed_since: since ?? "2020-01-01",
        opt_fields: "gid,name,completed,completed_at,due_on,projects",
        limit: 100,
      },
      maxResults,
    );
    let tasks = allTasks.filter((t) => t.completed).slice(0, maxResults);

    if (project) {
      const proj = await resolveProjectRef(project);
      tasks = tasks.filter((t) => t.projects?.some((p) => p.gid === proj.gid));
    }

    ok("completed", {
      count: tasks.length,
      tasks: tasks.map((t) => ({
        id: t.gid,
        name: t.name,
        completed: t.completed,
        projectIds: t.projects?.map((p) => p.gid) ?? [],
      })),
    }, [
      {
        command: "asana-cli show <ref>",
        description: "View task details",
        params: { ref: { required: true, description: "Task name, URL, id:xxx, or GID" } },
      },
      {
        command: "asana-cli reopen <ref>",
        description: "Reopen a completed task",
        params: { ref: { required: true, description: "Task name, URL, id:xxx, or GID" } },
      },
    ]);
  },
});
