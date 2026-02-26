import { define } from "gunshi";
import { getCliClient, withErrorHandler } from "../client.ts";
import { ok, truncate, formatStory } from "../../hateoas/index.ts";
import { resolveTaskRef } from "../../sdk/refs.ts";
import { listComments, addComment, updateComment, deleteComment, getLastCommentByUser } from "../../sdk/comments.ts";
import { getCurrentUser } from "../../sdk/users.ts";
import { fatal } from "../../hateoas/output.ts";

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
  run: (ctx) => withErrorHandler("comments", async () => {
    const client = getCliClient();
    const task = await resolveTaskRef(client, ctx.values.ref as string);
    const stories = await listComments(client, task.gid);
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
  }),
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
  run: (ctx) => withErrorHandler("comment-add", async () => {
    const client = getCliClient();
    const { ref, content } = ctx.values;
    const task = await resolveTaskRef(client, ref as string);
    const story = await addComment(client, task.gid, content as string);

    ok("comment-add", {
      task: { id: task.gid, name: task.name },
      comment: formatStory(story),
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
  }),
});

// ── comment-update ────────────────────────────────────────────────────

export const commentUpdate = define({
  name: "comment-update",
  description: "Update an existing comment/story",
  args: {
    ref: {
      type: "positional" as const,
      description: "Task reference",
      required: true,
    },
    story: {
      type: "string" as const,
      description: "Story GID",
      required: true,
    },
    content: {
      type: "string" as const,
      description: "New comment text",
      required: true,
    },
  },
  run: (ctx) => withErrorHandler("comment-update", async () => {
    const client = getCliClient();
    const task = await resolveTaskRef(client, ctx.values.ref as string);
    const updated = await updateComment(client, ctx.values.story as string, ctx.values.content as string);

    ok("comment-update", {
      task: { id: task.gid, name: task.name },
      comment: formatStory(updated),
    });
  }),
});

// ── comment-delete ────────────────────────────────────────────────────

export const commentDelete = define({
  name: "comment-delete",
  description: "Delete an existing comment/story",
  args: {
    ref: {
      type: "positional" as const,
      description: "Task reference",
      required: true,
    },
    story: {
      type: "string" as const,
      description: "Story GID",
      required: true,
    },
  },
  run: (ctx) => withErrorHandler("comment-delete", async () => {
    const client = getCliClient();
    const task = await resolveTaskRef(client, ctx.values.ref as string);
    await deleteComment(client, ctx.values.story as string);

    ok("comment-delete", {
      task: { id: task.gid, name: task.name },
      story: ctx.values.story as string,
      deleted: true,
    });
  }),
});

// ── comment-last ──────────────────────────────────────────────────────

export const commentLast = define({
  name: "comment-last",
  description: "Update the latest comment from the selected actor",
  args: {
    ref: {
      type: "positional" as const,
      description: "Task reference",
      required: true,
    },
    by: {
      type: "string" as const,
      description: "Currently supports: me",
      required: true,
    },
    update: {
      type: "string" as const,
      description: "New text for latest comment",
      required: true,
    },
  },
  run: (ctx) => withErrorHandler("comment-last", async () => {
    const by = ctx.values.by as string;
    if (by !== "me") {
      fatal("comment-last currently supports only --by me.", {
        code: "INVALID_INPUT",
        fix: "Use --by me.",
      });
    }

    const client = getCliClient();
    const task = await resolveTaskRef(client, ctx.values.ref as string);
    const me = await getCurrentUser(client);
    const target = await getLastCommentByUser(client, task.gid, me.gid);

    if (target === undefined) {
      fatal("No comment from current user found on this task.", {
        code: "NOT_FOUND",
        fix: "Use 'asana-cli comment-add <ref> --content <text>' to add a new comment.",
      });
    }

    const updated = await updateComment(client, target.gid, ctx.values.update as string);

    ok("comment-last", {
      task: { id: task.gid, name: task.name },
      selected_story: target.gid,
      comment: formatStory(updated),
    });
  }),
});
