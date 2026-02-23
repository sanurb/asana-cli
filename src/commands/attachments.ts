import { define } from "gunshi";
import { api } from "../lib/http/http-json-client";
import { resolveTaskRef } from "../refs.ts";
import { fatal, ok, truncate } from "../output.ts";

type AsanaAttachment = {
  readonly gid: string;
  readonly name?: string;
  readonly resource_subtype?: string;
  readonly host?: string;
  readonly permanent_url?: string;
  readonly download_url?: string;
  readonly created_at?: string;
};

function isHttpUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function formatAttachment(a: AsanaAttachment) {
  return {
    id: a.gid,
    name: a.name ?? a.gid,
    type: a.resource_subtype ?? null,
    host: a.host ?? null,
    url: a.permanent_url ?? a.download_url ?? null,
    created_at: a.created_at ?? null,
  };
}

export const attachments = define({
  name: "attachments",
  description: "List task attachments",
  args: {
    ref: {
      type: "positional" as const,
      description: "Task reference",
      required: true,
    },
  },
  run: async (ctx) => {
    const task = await resolveTaskRef(ctx.values.ref as string);
    const res = await api<AsanaAttachment[]>("GET", `/tasks/${task.gid}/attachments`, {
      query: {
        opt_fields: "gid,name,resource_subtype,host,permanent_url,download_url,created_at",
        limit: 100,
      },
    });
    const { items, meta } = truncate(res.data.map(formatAttachment));

    ok("attachments", {
      task: { id: task.gid, name: task.name },
      ...meta,
      attachments: items,
    }, [
      {
        command: "asana-cli attach-link <task-ref> --url <https://...> [--name <title>]",
        description: "Attach an external link to this task",
        params: { "task-ref": { value: task.gid, description: "Task gid" } },
      },
    ]);
  },
});

export const attachLink = define({
  name: "attach-link",
  description: "Attach an external URL to a task",
  args: {
    ref: {
      type: "positional" as const,
      description: "Task reference",
      required: true,
    },
    url: {
      type: "string" as const,
      description: "http(s) URL",
      required: true,
    },
    name: {
      type: "string" as const,
      description: "Attachment title",
    },
  },
  run: async (ctx) => {
    const task = await resolveTaskRef(ctx.values.ref as string);
    const url = String(ctx.values.url);
    if (!isHttpUrl(url)) {
      fatal(`Invalid URL "${url}".`, {
        code: "INVALID_URL",
        fix: "Use --url with an absolute http:// or https:// URL.",
      });
    }

    const body: Record<string, unknown> = {
      parent: task.gid,
      resource_subtype: "external",
      url,
    };
    if (ctx.values.name) body.name = ctx.values.name;

    const res = await api<AsanaAttachment>("POST", "/attachments", { body });
    ok("attach-link", {
      task: { id: task.gid, name: task.name },
      attachment: formatAttachment(res.data),
    }, [
      {
        command: "asana-cli attachments <task-ref>",
        description: "Verify task attachments",
        params: { "task-ref": { value: task.gid, description: "Task gid" } },
      },
    ]);
  },
});
