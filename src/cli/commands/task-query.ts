import { define } from "gunshi";
import { getCliClient, withErrorHandler } from "../client.ts";
import { ok, truncate, formatTask, formatStory } from "../../hateoas/index.ts";
import { resolveTaskRef, resolveProjectRef } from "../../sdk/refs.ts";
import { listMyTasks, listProjectTasks } from "../../sdk/tasks.ts";
import { listProjects } from "../../sdk/projects.ts";
import { listComments } from "../../sdk/comments.ts";

// ── today ───────────────────────────────────────────────────────────

export const today = define({
  name: "today",
  description: "Tasks due today + overdue (assignee: me)",
  args: {},
  run: (_ctx) => withErrorHandler("today", async () => {
    const client = getCliClient();
    const todayStr = new Date().toISOString().slice(0, 10);
    const tasks = await listMyTasks(client);
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
  }),
});

// ── inbox ───────────────────────────────────────────────────────────

export const inbox = define({
  name: "inbox",
  description: "My Tasks — incomplete, assigned to me",
  args: {},
  run: (_ctx) => withErrorHandler("inbox", async () => {
    const client = getCliClient();
    const tasks = await listMyTasks(client);
    const { items, meta } = truncate(tasks.map(formatTask));

    ok("inbox", {
      ...meta,
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
  }),
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
  run: (ctx) => withErrorHandler("search", async () => {
    const query = ctx.values.query as string;
    const client = getCliClient();
    const allTasks = await listMyTasks(client);
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
  }),
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
  run: (ctx) => withErrorHandler("list", async () => {
    const { project, section } = ctx.values;
    const client = getCliClient();
    let tasks;

    if (project) {
      const proj = await resolveProjectRef(client, project as string);
      tasks = await listProjectTasks(client, proj.gid, {
        sectionGid: section as string | undefined,
      });
    } else {
      tasks = await listMyTasks(client, { since: "now" });
    }

    const { items, meta } = truncate(tasks.map(formatTask));

    ok("list", {
      filter: project ? `project: ${project as string}` : "assignee: me",
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
          project: { value: (project as string | undefined) ?? undefined, description: "Project name or GID" },
        },
      },
    ]);
  }),
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
    attachments: {
      type: "boolean" as const,
      description: "Include lightweight attachment summary",
    },
  },
  run: (ctx) => withErrorHandler("show", async () => {
    const ref = ctx.values.ref as string;
    const client = getCliClient();
    const task = await resolveTaskRef(client, ref);
    const stories = await listComments(client, task.gid);
    const { items: commentItems, meta } = truncate(stories.map(formatStory));

    const includeAttachments = Boolean(ctx.values.attachments);
    const attachments = includeAttachments
      ? (await client.request<Array<{ gid: string; name?: string; resource_subtype?: string }>>(
          "GET",
          `/tasks/${task.gid}/attachments`,
          { query: { opt_fields: "gid,name,resource_subtype", limit: 20 } },
        )).data
      : [];

    ok("show", {
      ...formatTask(task),
      notes: task.notes || undefined,
      comments: commentItems,
      comments_truncated: meta.truncated,
      comments_total: meta.total,
      attachments_count: includeAttachments ? attachments.length : undefined,
      attachments_preview: includeAttachments
        ? attachments.slice(0, 5).map((a) => ({
            id: a.gid,
            name: a.name ?? a.gid,
            type: a.resource_subtype ?? null,
          }))
        : undefined,
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
  }),
});

// ── review ───────────────────────────────────────────────────────────

export const review = define({
  name: "review",
  description: "Dashboard: today, inbox, overdue, projects",
  args: {},
  run: (_ctx) => withErrorHandler("review", async () => {
    const client = getCliClient();
    const todayStr = new Date().toISOString().slice(0, 10);

    const [allTasks, projectsList] = await Promise.all([
      listMyTasks(client),
      listProjects(client, { archived: false }),
    ]);

    const incomplete = allTasks.filter((t) => !t.completed);
    const todayTasks = incomplete.filter((t) => t.due_on === todayStr);
    const overdue = incomplete.filter((t) => t.due_on && t.due_on < todayStr);
    const noDue = incomplete.filter((t) => !t.due_on);

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
  }),
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
  run: (ctx) => withErrorHandler("completed", async () => {
    const { since, project, limit: maxResults } = ctx.values;
    const client = getCliClient();
    const allTasks = await listMyTasks(client, {
      since: (since as string | undefined) ?? "2020-01-01",
      limit: maxResults as number | undefined,
    });
    let tasks = allTasks.filter((t) => t.completed).slice(0, maxResults as number);

    if (project) {
      const proj = await resolveProjectRef(client, project as string);
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
  }),
});
