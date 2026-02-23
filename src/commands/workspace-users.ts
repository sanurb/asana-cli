import { define } from "gunshi";
import { ok, truncate } from "../output.ts";
import { listWorkspaces, resolveWorkspace, resolveWorkspaceByRef } from "../lib/asana/workspace";
import { listWorkspaceUsers } from "../lib/asana/users";

export const workspaces = define({
  name: "workspaces",
  description: "List accessible workspaces and resolution metadata",
  args: {},
  run: async () => {
    const [all, resolved] = await Promise.all([listWorkspaces(), resolveWorkspace()]);
    const items = all.map((w) => ({
      gid: w.gid,
      name: w.name ?? w.gid,
      is_default: w.is_default ?? false,
      selected: w.gid === resolved.workspace.gid,
    }));

    ok("workspaces", {
      resolution_policy: {
        precedence: ["--workspace <ref>", "ASANA_WORKSPACE_GID", ".asana-cli.json workspace/workspace_gid", "lexicographic fallback by name then gid"],
        selected_source: resolved.source,
        selected_gid: resolved.workspace.gid,
      },
      workspaces: items,
    }, [
      {
        command: "asana-cli users --workspace <ref>",
        description: "List users in a workspace",
        params: {
          ref: { required: true, description: "Workspace name or gid" },
        },
      },
    ]);
  },
});

export const users = define({
  name: "users",
  description: "List or search users in a workspace",
  args: {
    workspace: {
      type: "string" as const,
      description: "Workspace name or gid (optional if globally resolved)",
    },
    query: {
      type: "string" as const,
      description: "Filter users by name/email",
      short: "q",
    },
  },
  run: async (ctx) => {
    const workspace = ctx.values.workspace
      ? await resolveWorkspaceByRef(ctx.values.workspace)
      : (await resolveWorkspace()).workspace;
    const usersList = await listWorkspaceUsers(workspace.gid);
    const query = (ctx.values.query ?? "").toLowerCase().trim();
    const filtered = query
      ? usersList.filter((u) => `${u.name ?? ""} ${u.email ?? ""}`.toLowerCase().includes(query))
      : usersList;
    const { items, meta } = truncate(filtered.map((u) => ({
      gid: u.gid,
      name: u.name ?? u.gid,
      email: u.email ?? null,
    })));

    ok("users", {
      workspace: { gid: workspace.gid, name: workspace.name ?? workspace.gid },
      query: query || undefined,
      ...meta,
      users: items,
    }, [
      {
        command: "asana-cli add <name> --assignee <me|email|gid>",
        description: "Create a task assigned to a user",
        params: {
          name: { required: true, description: "Task name" },
          assignee: { required: true, description: "Assignee reference" },
        },
      },
    ]);
  },
});
