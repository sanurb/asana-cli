import { define } from "gunshi";
import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getCliClient, withErrorHandler } from "../client.ts";
import { ok } from "../../hateoas/index.ts";
import { resolveTaskRef } from "../../sdk/refs.ts";
import { listSubtasks, listSubtasksDeep, addSubtask, type SubtaskNode } from "../../sdk/subtasks.ts";
import { resolveAssigneeRef } from "../../sdk/users.ts";
import { type AsanaTask } from "../../sdk/types.ts";

function taskToNode(task: AsanaTask, parentId: string | null, depth: number): SubtaskNode {
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
  run: (ctx) =>
    withErrorHandler("subtasks", async () => {
      const client = getCliClient();
      const parent = await resolveTaskRef(client, String(ctx.values.ref));
      const deep = Boolean(ctx.values.deep);

      if (!deep) {
        const children = await listSubtasks(client, parent.gid);
        const nodes = [...children]
          .sort((a, b) => a.name.localeCompare(b.name) || a.gid.localeCompare(b.gid))
          .map((x) => taskToNode(x, parent.gid, 1));
        ok("subtasks", {
          parent: { id: parent.gid, name: parent.name },
          deep: false,
          total: nodes.length,
          subtasks: nodes,
        });
        return;
      }

      const { nodes, truncated } = await listSubtasksDeep(client, parent.gid, 200);

      let fullOutputPath: string | undefined;
      if (truncated) {
        // Full traversal for file output (no limit)
        const { nodes: allNodes } = await listSubtasksDeep(client, parent.gid, Number.MAX_SAFE_INTEGER);
        const dir = await mkdtemp(join(tmpdir(), "asana-cli-subtasks-"));
        fullOutputPath = join(dir, "full-subtasks.json");
        await writeFile(fullOutputPath, JSON.stringify(allNodes, null, 2), "utf8");
      }

      ok("subtasks", {
        parent: { id: parent.gid, name: parent.name },
        deep: true,
        traversal: "breadth_first",
        total: nodes.length,
        truncated,
        full_output: fullOutputPath,
        subtasks: nodes,
      });
    }),
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
  run: (ctx) =>
    withErrorHandler("subtask-add", async () => {
      const client = getCliClient();
      const parent = await resolveTaskRef(client, String(ctx.values.parent));
      const workspaceGid = await client.getWorkspaceGid();

      let assigneeGid: string | undefined;
      if (ctx.values.assignee) {
        const resolved = await resolveAssigneeRef(client, String(ctx.values.assignee), workspaceGid);
        assigneeGid = resolved.gid;
      }

      const subtask = await addSubtask(client, parent.gid, {
        name: String(ctx.values.name),
        workspaceGid,
        due_on: ctx.values.due_on !== undefined ? String(ctx.values.due_on) : undefined,
        assigneeGid,
      });

      ok(
        "subtask-add",
        {
          parent: { id: parent.gid, name: parent.name },
          subtask: taskToNode(subtask, parent.gid, 1),
        },
        [
          {
            command: "asana-cli subtasks <task-ref>",
            description: "List direct subtasks on this parent",
            params: { "task-ref": { value: parent.gid, description: "Parent task gid" } },
          },
        ],
      );
    }),
});
