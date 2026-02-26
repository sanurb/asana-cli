import { define } from "gunshi";
import { getCliClient, withErrorHandler } from "../client.ts";
import { ok, truncate } from "../../hateoas/index.ts";
import { formatAttachment } from "../../hateoas/index.ts";
import { resolveTaskRef } from "../../sdk/refs.ts";
import { listAttachments, attachLink as sdkAttachLink } from "../../sdk/attachments.ts";

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
  run: (ctx) =>
    withErrorHandler("attachments", async () => {
      const client = getCliClient();
      const task = await resolveTaskRef(client, String(ctx.values.ref));
      const raw = await listAttachments(client, task.gid);
      const { items, meta } = truncate(raw.map(formatAttachment));

      ok(
        "attachments",
        {
          task: { id: task.gid, name: task.name },
          ...meta,
          attachments: items,
        },
        [
          {
            command: "asana-cli attach-link <task-ref> --url <https://...> [--name <title>]",
            description: "Attach an external link to this task",
            params: { "task-ref": { value: task.gid, description: "Task gid" } },
          },
        ],
      );
    }),
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
  run: (ctx) =>
    withErrorHandler("attach-link", async () => {
      const client = getCliClient();
      const task = await resolveTaskRef(client, String(ctx.values.ref));

      // SdkError INVALID_URL propagates through withErrorHandler
      const attachment = await sdkAttachLink(client, task.gid, {
        url: String(ctx.values.url),
        name: ctx.values.name !== undefined ? String(ctx.values.name) : undefined,
      });

      ok(
        "attach-link",
        {
          task: { id: task.gid, name: task.name },
          attachment: formatAttachment(attachment),
        },
        [
          {
            command: "asana-cli attachments <task-ref>",
            description: "Verify task attachments",
            params: { "task-ref": { value: task.gid, description: "Task gid" } },
          },
        ],
      );
    }),
});
