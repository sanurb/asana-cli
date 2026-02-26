import { type AsanaClient } from "./client.ts";
import { type AsanaTask, TASK_OPT_FIELDS } from "./types.ts";

export type AddTaskOpts = {
  name: string;
  workspaceGid: string;
  notes?: string;
  due_on?: string;
  parentGid?: string;
  assigneeGid?: string;
  projectGid?: string;
  sectionGid?: string;
  tagGids?: string[];
  customFields?: Record<string, string | number>;
};

export type UpdateTaskFields = {
  name?: string;
  notes?: string;
  due_on?: string;
  assigneeGid?: string;
  tagGids?: string[];
  customFields?: Record<string, string | number>;
};

export async function listMyTasks(
  client: AsanaClient,
  opts: { since?: string; limit?: number } = {},
): Promise<AsanaTask[]> {
  const workspaceGid = await client.getWorkspaceGid();
  return client.paginate<AsanaTask>("/tasks", {
    assignee: "me",
    workspace: workspaceGid,
    completed_since: opts.since ?? "now",
    opt_fields: TASK_OPT_FIELDS,
  }, opts.limit);
}

export async function listProjectTasks(
  client: AsanaClient,
  projectGid: string,
  opts: { sectionGid?: string; limit?: number } = {},
): Promise<AsanaTask[]> {
  const path = opts.sectionGid
    ? `/sections/${opts.sectionGid}/tasks`
    : `/projects/${projectGid}/tasks`;
  return client.paginate<AsanaTask>(path, {
    opt_fields: TASK_OPT_FIELDS,
  }, opts.limit);
}

export async function getTask(client: AsanaClient, gid: string): Promise<AsanaTask> {
  const res = await client.request<AsanaTask>("GET", `/tasks/${gid}`, {
    query: { opt_fields: TASK_OPT_FIELDS },
  });
  return res.data;
}

export async function addTask(client: AsanaClient, opts: AddTaskOpts): Promise<AsanaTask> {
  const body: Record<string, unknown> = {
    name: opts.name,
    workspace: opts.workspaceGid,
  };
  if (opts.notes !== undefined) body.notes = opts.notes;
  if (opts.due_on !== undefined) body.due_on = opts.due_on;
  if (opts.parentGid !== undefined) body.parent = opts.parentGid;
  if (opts.assigneeGid !== undefined) body.assignee = opts.assigneeGid;
  if (opts.projectGid !== undefined) body.projects = [opts.projectGid];
  if (opts.tagGids !== undefined) body.tags = opts.tagGids;
  if (opts.customFields !== undefined) body.custom_fields = opts.customFields;

  const res = await client.request<AsanaTask>("POST", "/tasks", {
    query: { opt_fields: TASK_OPT_FIELDS },
    body,
  });
  const task = res.data;

  // Move to section after creation if requested (Asana requires a separate call)
  if (opts.sectionGid !== undefined) {
    await client.request("POST", `/sections/${opts.sectionGid}/addTask`, {
      body: { task: task.gid },
    });
  }

  return task;
}

export async function completeTask(client: AsanaClient, gid: string): Promise<void> {
  await client.request("PUT", `/tasks/${gid}`, {
    body: { completed: true },
  });
}

export async function reopenTask(client: AsanaClient, gid: string): Promise<void> {
  await client.request("PUT", `/tasks/${gid}`, {
    body: { completed: false },
  });
}

export async function updateTask(
  client: AsanaClient,
  gid: string,
  fields: UpdateTaskFields,
): Promise<AsanaTask> {
  const body: Record<string, unknown> = {};
  if (fields.name !== undefined) body.name = fields.name;
  if (fields.notes !== undefined) body.notes = fields.notes;
  if (fields.due_on !== undefined) body.due_on = fields.due_on;
  if (fields.assigneeGid !== undefined) body.assignee = fields.assigneeGid;
  if (fields.tagGids !== undefined) body.tags = fields.tagGids;
  if (fields.customFields !== undefined) body.custom_fields = fields.customFields;

  const res = await client.request<AsanaTask>("PUT", `/tasks/${gid}`, {
    query: { opt_fields: TASK_OPT_FIELDS },
    body,
  });
  return res.data;
}

export async function deleteTask(client: AsanaClient, gid: string): Promise<void> {
  await client.request("DELETE", `/tasks/${gid}`);
}

export async function addToProject(
  client: AsanaClient,
  taskGid: string,
  projectGid: string,
): Promise<void> {
  await client.request("POST", `/tasks/${taskGid}/addProject`, {
    body: { project: projectGid },
  });
}

export async function removeFromProject(
  client: AsanaClient,
  taskGid: string,
  projectGid: string,
): Promise<void> {
  await client.request("POST", `/tasks/${taskGid}/removeProject`, {
    body: { project: projectGid },    
  });
}
