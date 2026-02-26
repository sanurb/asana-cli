import { type AsanaClient } from "./client.ts";
import { type AsanaTag } from "./types.ts";

export async function listTags(client: AsanaClient): Promise<AsanaTag[]> {
  const workspaceGid = await client.getWorkspaceGid();
  return client.paginate<AsanaTag>(`/workspaces/${workspaceGid}/tags`, {
    opt_fields: "gid,name",
  });
}
