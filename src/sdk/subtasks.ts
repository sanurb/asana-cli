import { type AsanaClient } from "./client.ts";
import { type AsanaTask } from "./types.ts";

const SUBTASK_OPT_FIELDS = "gid,name,completed,assignee,assignee.gid,assignee.name";

export type SubtaskNode = {
  id: string;
  name: string;
  parent_id: string | null;
  depth: number;
  completed: boolean;
  assignee_gid: string | null;
  assignee: string | null;
};

export async function listSubtasks(
  client: AsanaClient,
  parentGid: string,
): Promise<AsanaTask[]> {
  return client.paginate<AsanaTask>(`/tasks/${parentGid}/subtasks`, {
    opt_fields: SUBTASK_OPT_FIELDS,
  });
}

export async function listSubtasksDeep(
  client: AsanaClient,
  parentGid: string,
  maxItems = 200,
): Promise<{ nodes: SubtaskNode[]; truncated: boolean }> {
  const nodes: SubtaskNode[] = [];
  let truncated = false;

  // BFS queue: [taskGid, parentId | null, depth]
  const queue: Array<{ gid: string; parentId: string | null; depth: number }> = [
    { gid: parentGid, parentId: null, depth: -1 },
  ];


  while (queue.length > 0) {
    const current = queue.shift();
    if (current === undefined) break;

    const { gid, parentId, depth } = current;

    if (nodes.length >= maxItems) {
      truncated = true;
      break;
    }

    const children = await listSubtasks(client, gid);

    for (const task of children) {
      if (nodes.length >= maxItems) {
        truncated = true;
        break;
      }

      nodes.push({
        id: task.gid,
        name: task.name,
        parent_id: gid,
        depth: depth + 1,
        completed: task.completed ?? false,
        assignee_gid: task.assignee?.gid ?? null,
        assignee: task.assignee?.name ?? null,
      });

      queue.push({ gid: task.gid, parentId: gid, depth: depth + 1 });
    }

    if (truncated) break;
  }

  return { nodes, truncated };
}

export async function addSubtask(
  client: AsanaClient,
  parentGid: string,
  opts: {
    name: string;
    workspaceGid: string;
    due_on?: string;
    assigneeGid?: string;
  },
): Promise<AsanaTask> {
  const body: Record<string, string> = {
    name: opts.name,
    parent: parentGid,
    workspace: opts.workspaceGid,
  };
  if (opts.due_on !== undefined) body["due_on"] = opts.due_on;
  if (opts.assigneeGid !== undefined) body["assignee"] = opts.assigneeGid;

  const res = await client.request<AsanaTask>("POST", "/tasks", { body });
  return res.data;
}
