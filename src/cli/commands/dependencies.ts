import { define } from "gunshi";
import { getCliClient, withErrorHandler } from "../client.ts";
import { ok } from "../../hateoas/index.ts";
import { resolveTaskRef } from "../../sdk/refs.ts";
import { getDependencies, addDependency, removeDependency } from "../../sdk/dependencies.ts";

type Direction = "blocked_by" | "blocking" | "both";

export const deps = define({
  name: "deps",
  description: "Inspect dependency edges for a task",
  args: {
    ref: {
      type: "positional" as const,
      description: "Task reference",
      required: true,
    },
    direction: {
      type: "string" as const,
      description: "blocked_by|blocking|both",
      default: "both",
    },
  },
  run: (ctx) =>
    withErrorHandler("deps", async () => {
      const client = getCliClient();
      const task = await resolveTaskRef(client, String(ctx.values.ref));
      const direction = (ctx.values.direction ?? "both") as Direction;
      const { blockedBy, blocking } = await getDependencies(client, task.gid);

      ok(
        "deps",
        {
          task: { id: task.gid, name: task.name },
          direction,
          blocked_by: direction === "blocking" ? [] : blockedBy,
          blocking: direction === "blocked_by" ? [] : blocking,
        },
        [
          {
            command: "asana-cli dep-add <task-ref> --blocked-by <task-ref>",
            description: "Add a dependency edge",
          },
          {
            command: "asana-cli dep-remove <task-ref> --blocked-by <task-ref>",
            description: "Remove a dependency edge",
          },
        ],
      );
    }),
});

export const depAdd = define({
  name: "dep-add",
  description: "Add blocked_by dependency edge",
  args: {
    ref: {
      type: "positional" as const,
      description: "Task reference (dependent task)",
      required: true,
    },
    blocked_by: {
      type: "string" as const,
      description: "Blocking task reference",
      required: true,
    },
  },
  run: (ctx) =>
    withErrorHandler("dep-add", async () => {
      const client = getCliClient();
      const [task, blocker] = await Promise.all([
        resolveTaskRef(client, String(ctx.values.ref)),
        resolveTaskRef(client, String(ctx.values.blocked_by)),
      ]);

      // SdkError DEPENDENCY_CYCLE_RISK propagates through withErrorHandler
      await addDependency(client, task.gid, blocker.gid);

      ok("dep-add", {
        task: { id: task.gid, name: task.name },
        blocked_by: { id: blocker.gid, name: blocker.name },
      });
    }),
});

export const depRemove = define({
  name: "dep-remove",
  description: "Remove blocked_by dependency edge",
  args: {
    ref: {
      type: "positional" as const,
      description: "Task reference (dependent task)",
      required: true,
    },
    blocked_by: {
      type: "string" as const,
      description: "Blocking task reference",
      required: true,
    },
  },
  run: (ctx) =>
    withErrorHandler("dep-remove", async () => {
      const client = getCliClient();
      const [task, blocker] = await Promise.all([
        resolveTaskRef(client, String(ctx.values.ref)),
        resolveTaskRef(client, String(ctx.values.blocked_by)),
      ]);

      await removeDependency(client, task.gid, blocker.gid);

      ok("dep-remove", {
        task: { id: task.gid, name: task.name },
        blocked_by: { id: blocker.gid, name: blocker.name },
        removed: true,
      });
    }),
});
