import { define } from "gunshi";
import { api, paginate } from "../api.ts";
import { ok, truncate } from "../output.ts";
import { resolveTaskRef } from "../refs.ts";
import { type AsanaStory, STORY_OPT_FIELDS, formatStory } from "../types.ts";

// ── comments ─────────────────────────────────────────────────────────

export const comments = define({
  name: "comments",
  description: "List comments (stories) on a task",
  args: {
    ref: {
      type: "positional" as const,
      description: "Task reference (name, URL, id:xxx, or GID)",
      required: true,
    },
  },
  run: async (ctx) => {
    const task = await resolveTaskRef(ctx.values.ref as string);
    const stories = await paginate<AsanaStory>(`/tasks/${task.gid}/stories`, {
      opt_fields: STORY_OPT_FIELDS,
      limit: 100,
    });
    const { items, meta } = truncate(stories.map(formatStory));

    ok("comments", {
      taskId: task.gid,
      taskName: task.name,
      ...meta,
      comments: items,
    }, [
      {
        command: "asana-cli comment-add <ref> --content <text>",
        description: "Add a comment",
        params: {
          ref: { value: task.gid, description: "Task GID" },
          text: { required: true, description: "Comment text" },
        },
      },
      {
        command: "asana-cli show <ref>",
        description: "View full task details",
        params: { ref: { value: task.gid, description: "Task GID" } },
      },
    ]);
  },
});

// ── comment-add ──────────────────────────────────────────────────────

export const commentAdd = define({
  name: "comment-add",
  description: "Add a comment to a task",
  args: {
    ref: {
      type: "positional" as const,
      description: "Task reference (name, URL, id:xxx, or GID)",
      required: true,
    },
    content: {
      type: "string" as const,
      description: "Comment text",
      short: "c",
      required: true,
    },
  },
  run: async (ctx) => {
    const { ref, content } = ctx.values;
    const task = await resolveTaskRef(ref as string);
    const res = await api<AsanaStory>("POST", `/tasks/${task.gid}/stories`, {
      body: { text: content },
    });

    ok("comment-add", {
      task: { id: task.gid, name: task.name },
      comment: formatStory(res.data),
    }, [
      {
        command: "asana-cli comments <ref>",
        description: "View all comments on this task",
        params: { ref: { value: task.gid, description: "Task GID" } },
      },
      {
        command: "asana-cli show <ref>",
        description: "View full task details",
        params: { ref: { value: task.gid, description: "Task GID" } },
      },
    ]);
  },
});
