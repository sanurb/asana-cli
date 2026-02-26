import { type AsanaClient } from "./client.ts";
import { type AsanaUser } from "./types.ts";
import { sdkError } from "./errors.ts";

function looksLikeGid(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

function looksLikeEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

export async function getCurrentUser(client: AsanaClient): Promise<AsanaUser> {
  const res = await client.request<AsanaUser>("GET", "/users/me", {
    query: { opt_fields: "gid,name,email" },
  });
  return res.data;
}

export async function listWorkspaceUsers(client: AsanaClient, workspaceGid: string): Promise<AsanaUser[]> {
  const items = await client.paginate<AsanaUser>(`/workspaces/${workspaceGid}/users`, {
    opt_fields: "gid,name,email",
  });
  return [...items].sort((a, b) => (a.name ?? a.gid).localeCompare(b.name ?? b.gid));
}

export async function resolveAssigneeRef(
  client: AsanaClient,
  ref: string,
  workspaceGid: string,
): Promise<{ gid: string; source: string }> {
  const value = ref.trim();

  if (!value) {
    sdkError("Assignee cannot be empty.", "INVALID_INPUT", "Use me|<email>|<gid>.");
  }

  if (value === "me") {
    const me = await getCurrentUser(client);
    return { gid: me.gid, source: "me" };
  }

  if (looksLikeGid(value)) {
    return { gid: value, source: "gid" };
  }

  if (!looksLikeEmail(value)) {
    sdkError(
      `Unsupported assignee reference "${value}".`,
      "INVALID_INPUT",
      "Use me|<email>|<gid>.",
    );
  }

  const users = await listWorkspaceUsers(client, workspaceGid);

  if (users.length === 0) {
    sdkError(
      "Cannot resolve assignee email in this workspace.",
      "ASSIGNEE_EMAIL_LOOKUP_FORBIDDEN",
      "Email lookup may be blocked by workspace privacy. Use --assignee <gid> instead.",
    );
  }

  const lower = value.toLowerCase();
  const matches = users.filter((u) => (u.email ?? "").toLowerCase() === lower);

  if (matches.length === 1) {
    return { gid: matches[0].gid, source: "email" };
  }

  if (matches.length > 1) {
    sdkError(
      `Email "${value}" matches multiple users in this workspace.`,
      "AMBIGUOUS_REF",
      "Use --assignee <gid> to disambiguate.",
    );
  }

  const hasVisibleEmails = users.some((u) => typeof u.email === "string" && u.email.includes("@"));
  if (!hasVisibleEmails) {
    sdkError(
      `Email lookup is not permitted for workspace ${workspaceGid}.`,
      "ASSIGNEE_EMAIL_LOOKUP_FORBIDDEN",
      "Use --assignee <gid> instead of email in this workspace.",
    );
  }

  sdkError(
    `No user with email "${value}" found in this workspace.`,
    "NOT_FOUND",
    "Run 'asana-cli users --workspace <ref>' and use one of the listed user ids.",
  );
}
