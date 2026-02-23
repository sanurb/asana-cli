import { define } from "gunshi";
import { api } from "../lib/http/http-json-client";
import { resolveTaskRef } from "../refs.ts";
import { fatal, ok } from "../output.ts";
import { type AsanaTask } from "../types.ts";

type Direction = "blocked_by" | "blocking" | "both";

function formatEdgeTask(x: { gid: string; name?: string }) {
  return { id: x.gid, name: x.name ?? x.gid };
}

async function fetchTaskDependencies(gid: string): Promise<AsanaTask> {
  const res = await api<AsanaTask>("GET", `/tasks/${gid}`, {
    query: {
      opt_fields: "gid,name,dependencies,dependencies.gid,dependencies.name,dependents,dependents.gid,dependents.name",
    },
  });
  return res.data;
}

async function hasCycleRisk(taskGid: string, blockedByGid: string): Promise<boolean> {
  const seen = new Set<string>();
  const queue = [blockedByGid];
  let visits = 0;
  while (queue.length > 0 && visits < 150) {
    const current = queue.shift()!;
    if (current === taskGid) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    visits += 1;
    const node = await fetchTaskDependencies(current);
    for (const dep of node.dependencies ?? []) {
      queue.push(dep.gid);
    }
  }
  return false;
}

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
  run: async (ctx) => {
    const task = await resolveTaskRef(ctx.values.ref as string);
    const direction = (ctx.values.direction as Direction) ?? "both";
    const detailed = await fetchTaskDependencies(task.gid);
    const blockedBy = (detailed.dependencies ?? []).map(formatEdgeTask);
    const blocking = (detailed.dependents ?? []).map(formatEdgeTask);

    ok("deps", {
      task: { id: detailed.gid, name: detailed.name },
      direction,
      blocked_by: direction === "blocking" ? [] : blockedBy,
      blocking: direction === "blocked_by" ? [] : blocking,
    }, [
      {
        command: "asana-cli dep-add <task-ref> --blocked-by <task-ref>",
        description: "Add a dependency edge",
      },
      {
        command: "asana-cli dep-remove <task-ref> --blocked-by <task-ref>",
        description: "Remove a dependency edge",
      },
    ]);
  },
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
  run: async (ctx) => {
    const task = await resolveTaskRef(ctx.values.ref as string);
    const blocker = await resolveTaskRef(ctx.values.blocked_by as string);
    if (task.gid === blocker.gid) {
      fatal("A task cannot depend on itself.", {
        code: "DEPENDENCY_CYCLE_RISK",
        fix: "Choose a different --blocked-by task.",
      });
    }
    if (await hasCycleRisk(task.gid, blocker.gid)) {
      fatal("Dependency edge likely creates a cycle.", {
        code: "DEPENDENCY_CYCLE_RISK",
        fix: `Inspect edges with 'asana-cli deps ${task.gid} --direction both' or remove conflicts before adding this edge.`,
      });
    }

    await api("POST", `/tasks/${task.gid}/addDependencies`, {
      body: { dependencies: [blocker.gid] },
    });

    ok("dep-add", {
      task: { id: task.gid, name: task.name },
      blocked_by: { id: blocker.gid, name: blocker.name },
    });
  },
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
  run: async (ctx) => {
    const task = await resolveTaskRef(ctx.values.ref as string);
    const blocker = await resolveTaskRef(ctx.values.blocked_by as string);

    await api("POST", `/tasks/${task.gid}/removeDependencies`, {
      body: { dependencies: [blocker.gid] },
    });

    ok("dep-remove", {
      task: { id: task.gid, name: task.name },
      blocked_by: { id: blocker.gid, name: blocker.name },
      removed: true,
    });
  },
});
