import { api } from "../http/http-json-client";
import type { AsanaUser } from "../../types";

const NO_WORKSPACE_ERROR = "No workspaces found for the authenticated user.";

let cachedWorkspaceGid: string | undefined;

export async function getDefaultWorkspaceGid(): Promise<string> {
  if (cachedWorkspaceGid !== undefined) {
    return cachedWorkspaceGid;
  }

  const res = await api<AsanaUser>("GET", "/users/me", {
    query: { opt_fields: "workspaces,workspaces.gid,workspaces.name" },
  });

  const workspaces = res.data.workspaces ?? [];
  const firstWorkspace = workspaces[0];
  if (firstWorkspace?.gid === undefined) {
    throw new Error(NO_WORKSPACE_ERROR);
  }

  cachedWorkspaceGid = firstWorkspace.gid;
  return cachedWorkspaceGid;
}

export function clearWorkspaceCache(): void {
  cachedWorkspaceGid = undefined;
}
