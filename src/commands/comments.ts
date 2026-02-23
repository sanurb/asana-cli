import { define } from "gunshi";
import { api } from "../lib/http/http-json-client";
import { paginate } from "../lib/asana/paginate";
import { fatal, ok, truncate } from "../output.ts";
import { resolveTaskRef } from "../refs.ts";
import { type AsanaStory, STORY_OPT_FIELDS, formatStory } from "../types.ts";
import { getCurrentUser } from "../lib/asana/users";

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
      description: "Story ID",
      required: true,
    },
    content: {
      type: "string" as const,
      description: "New comment text",
      required: true,
    },
  },
  run: async (ctx) => {
    const task = await resolveTaskRef(ctx.values.ref as string);
    try {
      const res = await api<AsanaStory>("PUT", `/stories/${ctx.values.story}`, {
        body: { text: ctx.values.content },
      });
      ok("comment-update", {
        task: { id: task.gid, name: task.name },
        comment: formatStory(res.data),
      });
    } catch (error) {
      const envelope = error as { error?: { code?: string; message?: string } };
      if (envelope?.error?.code === "ASANA_FORBIDDEN") {
        fatal("You do not have permission to edit this comment.", {
          code: "COMMENT_PERMISSION_DENIED",
          fix: "Add a new comment instead with 'asana-cli comment-add <ref> --content <text>'.",
        });
      }
      throw error;
    }
  },
});

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
      description: "Story ID",
      required: true,
    },
  },
  run: async (ctx) => {
    const task = await resolveTaskRef(ctx.values.ref as string);
    try {
      await api("DELETE", `/stories/${ctx.values.story}`);
      ok("comment-delete", {
        task: { id: task.gid, name: task.name },
        story: String(ctx.values.story),
        deleted: true,
      });
    } catch (error) {
      const envelope = error as { error?: { code?: string } };
      if (envelope?.error?.code === "ASANA_FORBIDDEN") {
        fatal("You do not have permission to delete this comment.", {
          code: "COMMENT_PERMISSION_DENIED",
          fix: "Add a replacement comment instead with 'asana-cli comment-add <ref> --content <text>'.",
        });
      }
      throw error;
    }
  },
});

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
  run: async (ctx) => {
    const by = String(ctx.values.by);
    if (by !== "me") {
      fatal("comment-last currently supports only --by me.", {
        code: "INVALID_INPUT",
        fix: "Use --by me.",
      });
    }
    const task = await resolveTaskRef(ctx.values.ref as string);
    const me = await getCurrentUser();
    const stories = await paginate<AsanaStory>(`/tasks/${task.gid}/stories`, {
      opt_fields: STORY_OPT_FIELDS,
      limit: 100,
    });
    const mine = stories
      .filter((s) => s.created_by?.gid === me.gid)
      .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? "") || b.gid.localeCompare(a.gid));
    const target = mine[0];
    if (!target) {
      fatal("No comment from current user found on this task.", {
        code: "NOT_FOUND",
        fix: "Use 'asana-cli comment-add <ref> --content <text>' to add a new comment.",
      });
    }
    const updated = await api<AsanaStory>("PUT", `/stories/${target.gid}`, {
      body: { text: String(ctx.values.update) },
    });
    ok("comment-last", {
      task: { id: task.gid, name: task.name },
      selected_story: target.gid,
      comment: formatStory(updated.data),
    });
  },
});
