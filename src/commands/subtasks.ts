import { define } from "gunshi";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { api } from "../lib/http/http-json-client";
import { resolveTaskRef } from "../refs.ts";
import { type AsanaTask } from "../types.ts";
import { ok } from "../output.ts";
import { resolveAssigneeRef } from "../lib/asana/users";
import { getDefaultWorkspaceGid } from "../lib/asana/workspace";

const DEEP_MAX = 200;

function toNode(task: AsanaTask, parentId: string | null, depth: number) {
  return {
    id: task.gid,
    name: task.name,
    parent_id: parentId,
    depth,
    completed: task.completed ?? false,
    assignee_gid: task.assignee?.gid ?? null,
    assignee: task.assignee?.name ?? task.assignee?.gid ?? null,
  };
}

async function listDirectSubtasks(parentGid: string): Promise<AsanaTask[]> {
  const res = await api<AsanaTask[]>("GET", `/tasks/${parentGid}/subtasks`, {
    query: {
      opt_fields: "gid,name,completed,assignee,assignee.gid,assignee.name",
      limit: 100,
    },
  });
  return [...res.data].sort((a, b) => a.name.localeCompare(b.name) || a.gid.localeCompare(b.gid));
}

export const subtasks = define({
  name: "subtasks",
  description: "List direct or recursive subtasks",
  args: {
    ref: {
      type: "positional" as const,
      description: "Parent task reference",
      required: true,
    },
    deep: {
      type: "boolean" as const,
      description: "Breadth-first recursive traversal",
      short: "d",
    },
  },
  run: async (ctx) => {
    const parent = await resolveTaskRef(ctx.values.ref as string);
    const deep = Boolean(ctx.values.deep);

    if (!deep) {
      const children = await listDirectSubtasks(parent.gid);
      ok("subtasks", {
        parent: { id: parent.gid, name: parent.name },
        deep: false,
        total: children.length,
        subtasks: children.map((x) => toNode(x, parent.gid, 1)),
      });
      return;
    }

    const queue: Array<{ task: AsanaTask; parentId: string | null; depth: number }> = [
      { task: parent, parentId: null, depth: 0 },
    ];
    const output: ReturnType<typeof toNode>[] = [];

    while (queue.length > 0 && output.length < DEEP_MAX) {
      const current = queue.shift()!;
      if (current.depth > 0) {
        output.push(toNode(current.task, current.parentId, current.depth));
      }
      const children = await listDirectSubtasks(current.task.gid);
      for (const child of children) {
        queue.push({ task: child, parentId: current.task.gid, depth: current.depth + 1 });
      }
    }

    const truncated = queue.length > 0;
    let fullOutputPath: string | undefined;
    if (truncated) {
      const dir = await mkdtemp(join(tmpdir(), "asana-cli-subtasks-"));
      fullOutputPath = join(dir, "full-subtasks.json");
      const full = [];
      const pending = [...queue];
      while (pending.length > 0) {
        const current = pending.shift()!;
        if (current.depth > 0) full.push(toNode(current.task, current.parentId, current.depth));
        const children = await listDirectSubtasks(current.task.gid);
        for (const child of children) {
          pending.push({ task: child, parentId: current.task.gid, depth: current.depth + 1 });
        }
      }
      await writeFile(fullOutputPath, JSON.stringify([...output, ...full], null, 2), "utf8");
    }

    ok("subtasks", {
      parent: { id: parent.gid, name: parent.name },
      deep: true,
      traversal: "breadth_first",
      total: output.length,
      truncated,
      full_output: fullOutputPath,
      subtasks: output,
    });
  },
});

export const subtaskAdd = define({
  name: "subtask-add",
  description: "Create a subtask under a parent task",
  args: {
    parent: {
      type: "positional" as const,
      description: "Parent task reference",
      required: true,
    },
    name: {
      type: "string" as const,
      description: "Subtask name",
      required: true,
    },
    due_on: {
      type: "string" as const,
      description: "Due date (YYYY-MM-DD)",
    },
    assignee: {
      type: "string" as const,
      description: "Assignee me|<email>|<gid>",
    },
  },
  run: async (ctx) => {
    const parent = await resolveTaskRef(ctx.values.parent as string);
    const workspace = await getDefaultWorkspaceGid();
    const data: Record<string, unknown> = {
      name: ctx.values.name as string,
      parent: parent.gid,
      workspace,
    };
    if (ctx.values.due_on) data.due_on = ctx.values.due_on;
    if (ctx.values.assignee) {
      data.assignee = (await resolveAssigneeRef(ctx.values.assignee, workspace)).gid;
    }
    const res = await api<AsanaTask>("POST", "/tasks", { body: data });

    ok("subtask-add", {
      parent: { id: parent.gid, name: parent.name },
      subtask: toNode(res.data, parent.gid, 1),
    }, [
      {
        command: "asana-cli subtasks <task-ref>",
        description: "List direct subtasks on this parent",
        params: { "task-ref": { value: parent.gid, description: "Parent task gid" } },
      },
    ]);
  },
});
