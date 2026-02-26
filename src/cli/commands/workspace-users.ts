import { define } from "gunshi";
import { getCliClient, withErrorHandler } from "../client.ts";
import { ok, truncate } from "../../hateoas/index.ts";
import { listWorkspaces } from "../../sdk/workspace.ts";
import { listWorkspaceUsers } from "../../sdk/users.ts";
import { type AsanaWorkspace } from "../../sdk/types.ts";

async function resolveWorkspaceByRef(
  workspaceRef: string,
  all: AsanaWorkspace[],
): Promise<AsanaWorkspace> {
  const lower = workspaceRef.trim().toLowerCase();
  const byGid = all.find((w) => w.gid === workspaceRef.trim());
  if (byGid) return byGid;
  const byName = all.filter((w) => (w.name ?? "").toLowerCase() === lower);
  if (byName.length === 1) return byName[0];
  // Partial match
  const partial = all.filter((w) => (w.name ?? "").toLowerCase().includes(lower));
  if (partial.length === 1) return partial[0];
  // Fallback: fetch directly (may be a GID not in current list)
  const client = getCliClient();
  const res = await client.request<AsanaWorkspace>("GET", `/workspaces/${workspaceRef.trim()}`, {
    query: { opt_fields: "gid,name" },
  });
  return res.data;
}

export const workspaces = define({
  name: "workspaces",
  description: "List accessible workspaces and resolution metadata",
  args: {},
  run: () =>
    withErrorHandler("workspaces", async () => {
      const client = getCliClient();
      const [all, workspace] = await Promise.all([
        listWorkspaces(client),
        client.getWorkspace(),
      ]);
      const items = all.map((w) => ({
        gid: w.gid,
        name: w.name ?? w.gid,
        is_default: w.is_default ?? false,
        selected: w.gid === workspace.gid,
      }));

      ok(
        "workspaces",
        {
          resolution_policy: {
            precedence: [
              "--workspace <ref>",
              "ASANA_WORKSPACE_GID",
              ".asana-cli.json workspace/workspace_gid",
              "lexicographic fallback by name then gid",
            ],
            selected_source: workspace.source,
            selected_gid: workspace.gid,
          },
          workspaces: items,
        },
        [
          {
            command: "asana-cli users --workspace <ref>",
            description: "List users in a workspace",
            params: {
              ref: { required: true, description: "Workspace name or gid" },
            },
          },
        ],
      );
    }),
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
  run: (ctx) =>
    withErrorHandler("users", async () => {
      const client = getCliClient();

      let workspace: { gid: string; name?: string };
      if (ctx.values.workspace) {
        const all = await listWorkspaces(client);
        workspace = await resolveWorkspaceByRef(String(ctx.values.workspace), all);
      } else {
        workspace = await client.getWorkspace();
      }

      const usersList = await listWorkspaceUsers(client, workspace.gid);
      const query = (ctx.values.query ?? "").toLowerCase().trim();
      const filtered = query
        ? usersList.filter((u) =>
            `${u.name ?? ""} ${u.email ?? ""}`.toLowerCase().includes(query),
          )
        : usersList;

      const { items, meta } = truncate(
        filtered.map((u) => ({
          gid: u.gid,
          name: u.name ?? u.gid,
          email: u.email ?? null,
        })),
      );

      ok(
        "users",
        {
          workspace: { gid: workspace.gid, name: workspace.name ?? workspace.gid },
          query: query || undefined,
          ...meta,
          users: items,
        },
        [
          {
            command: "asana-cli add <name> --assignee <me|email|gid>",
            description: "Create a task assigned to a user",
            params: {
              name: { required: true, description: "Task name" },
              assignee: { required: true, description: "Assignee reference" },
            },
          },
        ],
      );
    }),
});
