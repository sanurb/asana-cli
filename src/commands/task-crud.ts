import { define } from "gunshi";
import { api } from "../lib/http/http-json-client";
import { getDefaultWorkspaceGid } from "../lib/asana/workspace";
import { ok } from "../output.ts";
import { resolveTaskRef, resolveProjectRef } from "../refs.ts";
import { type AsanaTask, formatTask } from "../types.ts";

// ── add ──────────────────────────────────────────────────────────────

export const add = define({
  name: "add",
  description: "Create a new task",
  args: {
    name: {
      type: "positional" as const,
      description: "Task name",
      required: true,
    },
    description: {
      type: "string" as const,
      description: "Task description / notes",
      short: "d",
    },
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
    parent: {
      type: "string" as const,
      description: "Parent task GID (for subtasks)",
    },
    due_on: {
      type: "string" as const,
      description: "Due date (YYYY-MM-DD)",
    },
    tags: {
      type: "string" as const,
      description: "Comma-separated tag GIDs",
    },
  },
  examples: "asana-cli add 'Fix login bug' --due_on 2025-03-01 --project MyProject",
  run: async (ctx) => {
    const { name, description, project, section, parent, due_on, tags } = ctx.values;
    const workspace = await getDefaultWorkspaceGid();
    const data: Record<string, unknown> = {
      name: name as string,
      workspace,
      completed: false,
    };

    if (description) data.notes = description;
    if (due_on) data.due_on = due_on;
    if (parent) data.parent = parent;
    if (tags) data.tags = tags.split(",").map((s) => s.trim());

    if (project) {
      const proj = await resolveProjectRef(project);
      data.projects = [proj.gid];
      if (section) data.section = section;
    } else {
      data.assignee = "me";
    }

    const res = await api<AsanaTask>("POST", "/tasks", { body: data });
    const gid = res.data.gid;

    ok("add", formatTask(res.data), [
      {
        command: "asana-cli show <ref>",
        description: "View the created task",
        params: { ref: { value: gid, description: "Task GID" } },
      },
      {
        command: "asana-cli complete <ref>",
        description: "Complete this task",
        params: { ref: { value: gid, description: "Task GID" } },
      },
      { command: "asana-cli today", description: "View today's tasks" },
    ]);
  },
});

// ── complete ─────────────────────────────────────────────────────────

export const complete = define({
  name: "complete",
  description: "Mark a task as complete",
  args: {
    ref: {
      type: "positional" as const,
      description: "Task reference (name, URL, id:xxx, or GID)",
      required: true,
    },
  },
  run: async (ctx) => {
    const task = await resolveTaskRef(ctx.values.ref as string);
    await api("PUT", `/tasks/${task.gid}`, { body: { completed: true } });

    ok("complete", { completed: formatTask(task) }, [
      { command: "asana-cli today", description: "View remaining today tasks" },
      { command: "asana-cli inbox", description: "View all incomplete tasks" },
      {
        command: "asana-cli reopen <ref>",
        description: "Undo — reopen this task",
        params: { ref: { value: task.gid, description: "Task GID" } },
      },
    ]);
  },
});

// ── reopen ───────────────────────────────────────────────────────────

export const reopen = define({
  name: "reopen",
  description: "Reopen a completed task",
  args: {
    ref: {
      type: "positional" as const,
      description: "Task reference (name, URL, id:xxx, or GID)",
      required: true,
    },
  },
  run: async (ctx) => {
    const task = await resolveTaskRef(ctx.values.ref as string);
    await api("PUT", `/tasks/${task.gid}`, { body: { completed: false } });

    ok("reopen", { task: formatTask(task) }, [
      {
        command: "asana-cli show <ref>",
        description: "View reopened task details",
        params: { ref: { value: task.gid, description: "Task GID" } },
      },
      {
        command: "asana-cli complete <ref>",
        description: "Complete this task again",
        params: { ref: { value: task.gid, description: "Task GID" } },
      },
    ]);
  },
});

// ── delete ───────────────────────────────────────────────────────────

const deleteCmd = define({
  name: "delete",
  description: "Delete a task permanently",
  args: {
    ref: {
      type: "positional" as const,
      description: "Task reference (name, URL, id:xxx, or GID)",
      required: true,
    },
  },
  run: async (ctx) => {
    const task = await resolveTaskRef(ctx.values.ref as string);
    await api("DELETE", `/tasks/${task.gid}`);

    ok("delete", { deleted: { id: task.gid, name: task.name } }, [
      { command: "asana-cli today", description: "View today's tasks" },
      { command: "asana-cli inbox", description: "View remaining tasks" },
    ]);
  },
});

export { deleteCmd as delete };

// ── update ───────────────────────────────────────────────────────────

export const update = define({
  name: "update",
  description: "Update task fields",
  args: {
    ref: {
      type: "positional" as const,
      description: "Task reference (name, URL, id:xxx, or GID)",
      required: true,
    },
    name: {
      type: "string" as const,
      description: "New task name",
      short: "n",
    },
    description: {
      type: "string" as const,
      description: "New description / notes",
      short: "d",
    },
    due_on: {
      type: "string" as const,
      description: "New due date (YYYY-MM-DD)",
    },
    tags: {
      type: "string" as const,
      description: "Comma-separated tag GIDs",
    },
  },
  run: async (ctx) => {
    const { ref, name, description, due_on, tags } = ctx.values;
    const task = await resolveTaskRef(ref as string);
    const data: Record<string, unknown> = {};
    if (name) data.name = name;
    if (description !== undefined) data.notes = description;
    if (due_on) data.due_on = due_on;
    if (tags) data.tags = tags.split(",").map((s) => s.trim());

    const res = await api<AsanaTask>("PUT", `/tasks/${task.gid}`, { body: data });

    ok("update", formatTask(res.data), [
      {
        command: "asana-cli show <ref>",
        description: "View updated task",
        params: { ref: { value: res.data.gid, description: "Task GID" } },
      },
      {
        command: "asana-cli complete <ref>",
        description: "Complete this task",
        params: { ref: { value: res.data.gid, description: "Task GID" } },
      },
    ]);
  },
});

// ── move ─────────────────────────────────────────────────────────────

export const move = define({
  name: "move",
  description: "Move a task to a different project, section, or parent",
  args: {
    ref: {
      type: "positional" as const,
      description: "Task reference (name, URL, id:xxx, or GID)",
      required: true,
    },
    project: {
      type: "string" as const,
      description: "Target project name or GID",
      short: "p",
    },
    section: {
      type: "string" as const,
      description: "Target section GID",
      short: "s",
    },
    parent: {
      type: "string" as const,
      description: "Parent task GID (make subtask)",
    },
  },
  run: async (ctx) => {
    const { ref, project, section, parent } = ctx.values;
    const task = await resolveTaskRef(ref as string);
    const data: Record<string, unknown> = {};

    if (project) {
      const proj = await resolveProjectRef(project);
      data.projects = [proj.gid];
      if (section) data.section = section;
    }
    if (parent) data.parent = parent;

    const res = await api<AsanaTask>("PUT", `/tasks/${task.gid}`, { body: data });

    ok("move", formatTask(res.data), [
      {
        command: "asana-cli show <ref>",
        description: "View moved task",
        params: { ref: { value: res.data.gid, description: "Task GID" } },
      },
      {
        command: "asana-cli list [--project <project>]",
        description: "List tasks in target project",
        params: { project: { value: project ?? undefined, description: "Project name or GID" } },
      },
    ]);
  },
});
