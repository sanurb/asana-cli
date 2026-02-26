/**
 * Workspace utilities for the SDK layer.
 *
 * All state lives on the AsanaClient, not in module-level variables.
 * These are pure helpers — they receive a client and return data.
 */

import { type AsanaClient } from "./client.ts";
import { type AsanaWorkspace } from "./types.ts";

/**
 * Lists all workspaces accessible to the authenticated user.
 * Returned sorted lexicographically by name then GID (deterministic).
 */
export async function listWorkspaces(client: AsanaClient): Promise<AsanaWorkspace[]> {
  const res = await client.request<AsanaWorkspace[]>("GET", "/workspaces", {
    query: { opt_fields: "gid,name,is_default", limit: 100 },
  });
  return [...(res.data as AsanaWorkspace[])].sort((a, b) =>
    (a.name ?? a.gid).toLowerCase().localeCompare((b.name ?? b.gid).toLowerCase()),
  );
}

/**
 * Returns the default workspace GID for this client.
 * Delegates to the client's lazy workspace resolver.
 */
export async function getWorkspaceGid(client: AsanaClient): Promise<string> {
  return client.getWorkspaceGid();
}
