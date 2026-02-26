import { define } from "gunshi";
import { getCliClient, getCliCustomFields, withErrorHandler } from "../client.ts";
import { ok, formatTask } from "../../hateoas/index.ts";
import { resolveTaskRef, resolveProjectRef, requireProjectScope } from "../../sdk/refs.ts";
import { addTask, completeTask, reopenTask, updateTask, deleteTask, addToProject, removeFromProject } from "../../sdk/tasks.ts";
import { resolveAssigneeRef } from "../../sdk/users.ts";
import { buildCustomFieldsPayload } from "../../sdk/custom-fields.ts";
import { type AsanaTask } from "../../sdk/types.ts";

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
      description: "Section name or GID",
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
    assignee: {
      type: "string" as const,
      description: "Assignee: me|<email>|<gid>",
    },
    tags: {
      type: "string" as const,
      description: "Comma-separated tag GIDs",
    },
  },
  examples: "asana-cli add 'Fix login bug' --due_on 2025-03-01 --project MyProject",
  run: (ctx) => withErrorHandler("add", async () => {
    const client = getCliClient();
    const { name, description, project, section, parent, due_on, tags, assignee } = ctx.values;
    const workspace = await client.getWorkspaceGid();

    let projectGid: string | undefined;
    let sectionGid: string | undefined;

    if (project) {
      const proj = await resolveProjectRef(client, project as string);
      projectGid = proj.gid;
      if (section) {
        sectionGid = section as string;
      }
    }

    let assigneeGid: string | undefined;
    if (assignee) {
      const resolved = await resolveAssigneeRef(client, assignee as string, workspace);
      assigneeGid = resolved.gid;
    } else if (!project) {
      const resolved = await resolveAssigneeRef(client, "me", workspace);
      assigneeGid = resolved.gid;
    }

    const customFields = await buildCustomFieldsPayload(
      client,
      projectGid,
      getCliCustomFields(),
    );

    const task = await addTask(client, {
      name: name as string,
      workspaceGid: workspace,
      notes: description as string | undefined,
      due_on: due_on as string | undefined,
      parentGid: parent as string | undefined,
      tagGids: tags ? (tags as string).split(",").map((s) => s.trim()) : undefined,
      assigneeGid,
      projectGid,
      sectionGid,
      customFields,
    });

    ok("add", formatTask(task), [
      {
        command: "asana-cli show <ref>",
        description: "View the created task",
        params: { ref: { value: task.gid, description: "Task GID" } },
      },
      {
        command: "asana-cli complete <ref>",
        description: "Complete this task",
        params: { ref: { value: task.gid, description: "Task GID" } },
      },
      { command: "asana-cli today", description: "View today's tasks" },
    ]);
  }),
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
  run: (ctx) => withErrorHandler("complete", async () => {
    const client = getCliClient();
    const task = await resolveTaskRef(client, ctx.values.ref as string);
    await completeTask(client, task.gid);

    ok("complete", { completed: formatTask(task) }, [
      { command: "asana-cli today", description: "View remaining today tasks" },
      { command: "asana-cli inbox", description: "View all incomplete tasks" },
      {
        command: "asana-cli reopen <ref>",
        description: "Undo — reopen this task",
        params: { ref: { value: task.gid, description: "Task GID" } },
      },
    ]);
  }),
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
  run: (ctx) => withErrorHandler("reopen", async () => {
    const client = getCliClient();
    const task = await resolveTaskRef(client, ctx.values.ref as string);
    await reopenTask(client, task.gid);

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
  }),
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
  run: (ctx) => withErrorHandler("delete", async () => {
    const client = getCliClient();
    const task = await resolveTaskRef(client, ctx.values.ref as string);
    await deleteTask(client, task.gid);

    ok("delete", { deleted: { id: task.gid, name: task.name } }, [
      { command: "asana-cli today", description: "View today's tasks" },
      { command: "asana-cli inbox", description: "View remaining tasks" },
    ]);
  }),
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
    assignee: {
      type: "string" as const,
      description: "Assignee: me|<email>|<gid>",
    },
    project: {
      type: "string" as const,
      description: "Project ref for scoped operations (required for --cf on multi-home tasks)",
      short: "p",
    },
    tags: {
      type: "string" as const,
      description: "Comma-separated tag GIDs",
    },
  },
  run: (ctx) => withErrorHandler("update", async () => {
    const client = getCliClient();
    const { ref, name, description, due_on, tags, assignee, project } = ctx.values;
    const task = await resolveTaskRef(client, ref as string);
    requireProjectScope(task, project as string | undefined);

    let projectGid: string | undefined;
    if (project) {
      const proj = await resolveProjectRef(client, project as string);
      projectGid = proj.gid;
    }

    let assigneeGid: string | undefined;
    if (assignee) {
      const workspaceGid = task.workspace?.gid ?? (await client.getWorkspaceGid());
      const resolved = await resolveAssigneeRef(client, assignee as string, workspaceGid);
      assigneeGid = resolved.gid;
    }

    const customFields = await buildCustomFieldsPayload(
      client,
      projectGid,
      getCliCustomFields(),
    );

    const updated = await updateTask(client, task.gid, {
      name: name as string | undefined,
      notes: description as string | undefined,
      due_on: due_on as string | undefined,
      assigneeGid,
      tagGids: tags ? (tags as string).split(",").map((s) => s.trim()) : undefined,
      customFields,
    });

    ok("update", formatTask(updated), [
      {
        command: "asana-cli show <ref>",
        description: "View updated task",
        params: { ref: { value: updated.gid, description: "Task GID" } },
      },
      {
        command: "asana-cli complete <ref>",
        description: "Complete this task",
        params: { ref: { value: updated.gid, description: "Task GID" } },
      },
    ]);
  }),
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
  run: (ctx) => withErrorHandler("move", async () => {
    const client = getCliClient();
    const { ref, project, section, parent } = ctx.values;
    const task = await resolveTaskRef(client, ref as string);
    const body: Record<string, unknown> = {};

    if (project) {
      const proj = await resolveProjectRef(client, project as string);
      body.projects = [proj.gid];
      if (section) body.section = section;
    }
    if (parent) body.parent = parent;

    const res = await client.request<AsanaTask>(
      "PUT",
      `/tasks/${task.gid}`,
      { body },
    );

    ok("move", formatTask(res.data), [
      {
        command: "asana-cli show <ref>",
        description: "View moved task",
        params: { ref: { value: task.gid, description: "Task GID" } },
      },
      {
        command: "asana-cli list [--project <project>]",
        description: "List tasks in target project",
        params: { project: { value: project ?? undefined, description: "Project name or GID" } },
      },
    ]);
  }),
});

// ── project-add ──────────────────────────────────────────────────────

export const projectAdd = define({
  name: "project-add",
  description: "Add task membership in a project",
  args: {
    ref: {
      type: "positional" as const,
      description: "Task reference",
      required: true,
    },
    project: {
      type: "string" as const,
      description: "Project reference",
      required: true,
    },
  },
  run: (ctx) => withErrorHandler("project-add", async () => {
    const client = getCliClient();
    const task = await resolveTaskRef(client, ctx.values.ref as string);
    const proj = await resolveProjectRef(client, ctx.values.project as string);
    await addToProject(client, task.gid, proj.gid);

    ok("project-add", {
      task: { id: task.gid, name: task.name },
      project: { id: proj.gid, name: proj.name },
      added: true,
    });
  }),
});

// ── project-remove ───────────────────────────────────────────────────

export const projectRemove = define({
  name: "project-remove",
  description: "Remove task membership from a project",
  args: {
    ref: {
      type: "positional" as const,
      description: "Task reference",
      required: true,
    },
    project: {
      type: "string" as const,
      description: "Project reference",
      required: true,
    },
  },
  run: (ctx) => withErrorHandler("project-remove", async () => {
    const client = getCliClient();
    const task = await resolveTaskRef(client, ctx.values.ref as string);
    const proj = await resolveProjectRef(client, ctx.values.project as string);
    await removeFromProject(client, task.gid, proj.gid);

    ok("project-remove", {
      task: { id: task.gid, name: task.name },
      project: { id: proj.gid, name: proj.name },
      removed: true,
    });
  }),
});
