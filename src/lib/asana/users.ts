import { api } from "../http/http-json-client";
import { fatal } from "../../output.ts";

type WorkspaceUser = {
  readonly gid: string;
  readonly name?: string;
  readonly email?: string;
};

type MeResponse = {
  readonly gid: string;
  readonly name?: string;
  readonly email?: string;
};

let cachedMe: MeResponse | undefined;

function looksLikeGid(value: string): boolean {
  return /^\d+$/.test(value.trim());
}

function looksLikeEmail(value: string): boolean {
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

export async function getCurrentUser(): Promise<MeResponse> {
  if (cachedMe) return cachedMe;
  const res = await api<MeResponse>("GET", "/users/me", {
    query: { opt_fields: "gid,name,email" },
  });
  cachedMe = res.data;
  return cachedMe;
}

export async function listWorkspaceUsers(workspaceGid: string): Promise<WorkspaceUser[]> {
  const res = await api<WorkspaceUser[]>("GET", `/workspaces/${workspaceGid}/users`, {
    query: { opt_fields: "gid,name,email", limit: 100 },
  });
  return [...res.data].sort((a, b) => (a.name ?? a.gid).localeCompare(b.name ?? b.gid));
}

export async function resolveAssigneeRef(ref: string, workspaceGid: string): Promise<{ gid: string; source: string }> {
  const value = ref.trim();
  if (!value) {
    fatal("Assignee cannot be empty.", {
      code: "INVALID_INPUT",
      fix: "Use --assignee me|<email>|<gid>.",
    });
  }

  if (value === "me") {
    const me = await getCurrentUser();
    return { gid: me.gid, source: "me" };
  }

  if (looksLikeGid(value)) {
    return { gid: value, source: "gid" };
  }

  if (!looksLikeEmail(value)) {
    fatal(`Unsupported assignee reference "${value}".`, {
      code: "INVALID_INPUT",
      fix: "Use --assignee me, --assignee <email>, or --assignee <gid>.",
    });
  }

  const users = await listWorkspaceUsers(workspaceGid);
  if (users.length === 0) {
    fatal("Cannot resolve assignee email in this workspace.", {
      code: "ASSIGNEE_EMAIL_LOOKUP_FORBIDDEN",
      fix: "Email lookup may be blocked by workspace privacy. Use --assignee <gid> instead.",
    });
  }

  const lower = value.toLowerCase();
  const matches = users.filter((u) => (u.email ?? "").toLowerCase() === lower);
  if (matches.length === 1) {
    return { gid: matches[0].gid, source: "email" };
  }
  if (matches.length > 1) {
    fatal(`Email "${value}" matches multiple users in this workspace.`, {
      code: "AMBIGUOUS_REF",
      fix: "Use --assignee <gid> to disambiguate.",
    });
  }

  const hasVisibleEmails = users.some((u) => typeof u.email === "string" && u.email.includes("@"));
  if (!hasVisibleEmails) {
    fatal(`Email lookup is not permitted for workspace ${workspaceGid}.`, {
      code: "ASSIGNEE_EMAIL_LOOKUP_FORBIDDEN",
      fix: "Use --assignee <gid> instead of email in this workspace.",
    });
  }

  fatal(`No user with email "${value}" found in this workspace.`, {
    code: "NOT_FOUND",
    fix: "Run 'asana-cli users --workspace <ref>' and use one of the listed user ids.",
  });
}
