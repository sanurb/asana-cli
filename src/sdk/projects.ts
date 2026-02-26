import { type AsanaClient } from "./client.ts";
import { type AsanaProject, PROJECT_OPT_FIELDS } from "./types.ts";

export async function listProjects(
  client: AsanaClient,
  opts: { archived?: boolean } = {},
): Promise<AsanaProject[]> {
  const workspaceGid = await client.getWorkspaceGid();
  return client.paginate<AsanaProject>(`/workspaces/${workspaceGid}/projects`, {
    opt_fields: PROJECT_OPT_FIELDS,
    archived: opts.archived ?? false,
  });
}

export async function getProject(client: AsanaClient, gid: string): Promise<AsanaProject> {
  const res = await client.request<AsanaProject>("GET", `/projects/${gid}`, {
    query: { opt_fields: PROJECT_OPT_FIELDS },
  });
  return res.data;
}

export async function addProject(
  client: AsanaClient,
  name: string,
  workspaceGid: string,
): Promise<AsanaProject> {
  const res = await client.request<AsanaProject>("POST", "/projects", {
    query: { opt_fields: PROJECT_OPT_FIELDS },
    body: { name, workspace: workspaceGid },
  });
  return res.data;
}
