import { define } from "gunshi";
import { readFile } from "node:fs/promises";
import { getCliClient, withErrorHandler } from "../client.ts";
import { ok, fatal } from "../../hateoas/index.ts";
import { type AsanaClient } from "../../sdk/client.ts";
import { resolveTaskRef, resolveProjectRef } from "../../sdk/refs.ts";
import { sdkError } from "../../sdk/errors.ts";
import { formatTask } from "../../hateoas/format.ts";
import {
  listMyTasks,
  addTask,
  completeTask,
  reopenTask,
  updateTask,
  deleteTask,
} from "../../sdk/tasks.ts";
import { listProjects } from "../../sdk/projects.ts";
import { listSections } from "../../sdk/sections.ts";
import { addComment } from "../../sdk/comments.ts";
import { listTags } from "../../sdk/tags.ts";
import { runBatch, type BatchStep } from "../../sdk/batch.ts";

// ── Plan parsing ─────────────────────────────────────────────────────

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parsePlan(raw: string): BatchStep[] {
  const parsed = JSON.parse(raw) as unknown;
  if (Array.isArray(parsed)) return parsed as BatchStep[];
  if (isObject(parsed) && Array.isArray(parsed["steps"])) return parsed["steps"] as BatchStep[];
  fatal("Batch plan must be an array of steps or { steps: [...] }.", {
    code: "BATCH_PLAN_INVALID",
    fix: 'Use --file with JSON: {"steps":[{"command":"add","args":{"name":"X"}}]}',
  });
}

// ── SDK dispatch ─────────────────────────────────────────────────────

async function sdkDispatch(
  client: AsanaClient,
  command: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const ref = String(args["_"] ?? args["ref"] ?? "");

  switch (command) {
    case "add": {
      const workspaceGid = await client.getWorkspaceGid();
      const task = await addTask(client, {
        name: String(args["name"] ?? ""),
        workspaceGid,
        notes: args["notes"] !== undefined ? String(args["notes"]) : undefined,
        due_on: args["due_on"] !== undefined ? String(args["due_on"]) : undefined,
        assigneeGid: args["assignee"] !== undefined ? String(args["assignee"]) : undefined,
        projectGid: args["project"] !== undefined ? String(args["project"]) : undefined,
      });
      return formatTask(task);
    }

    case "complete": {
      const task = await resolveTaskRef(client, ref);
      await completeTask(client, task.gid);
      return { id: task.gid, name: task.name, completed: true };
    }

    case "reopen": {
      const task = await resolveTaskRef(client, ref);
      await reopenTask(client, task.gid);
      return { id: task.gid, name: task.name, completed: false };
    }

    case "delete": {
      const task = await resolveTaskRef(client, ref);
      await deleteTask(client, task.gid);
      return { id: task.gid, name: task.name, deleted: true };
    }

    case "update": {
      const task = await resolveTaskRef(client, ref);
      const updated = await updateTask(client, task.gid, {
        name: args["name"] !== undefined ? String(args["name"]) : undefined,
        notes: args["notes"] !== undefined ? String(args["notes"]) : undefined,
        due_on: args["due_on"] !== undefined ? String(args["due_on"]) : undefined,
        assigneeGid: args["assignee"] !== undefined ? String(args["assignee"]) : undefined,
      });
      return formatTask(updated);
    }

    case "show": {
      const task = await resolveTaskRef(client, ref);
      return formatTask(task);
    }

    case "list":
    case "inbox": {
      const tasks = await listMyTasks(client);
      return tasks.map(formatTask);
    }

    case "today": {
      const today = new Date().toISOString().slice(0, 10);
      const tasks = await listMyTasks(client);
      const filtered = tasks.filter((t) => t.due_on === today);
      return filtered.map(formatTask);
    }

    case "search": {
      const query = String(args["query"] ?? args["_"] ?? "").toLowerCase();
      const tasks = await listMyTasks(client);
      const filtered = query
        ? tasks.filter((t) => t.name.toLowerCase().includes(query))
        : tasks;
      return filtered.map(formatTask);
    }

    case "completed": {
      const tasks = await listMyTasks(client, { since: "2000-01-01T00:00:00.000Z" });
      const done = tasks.filter((t) => t.completed === true);
      return done.map(formatTask);
    }

    case "comment-add": {
      const task = await resolveTaskRef(client, ref);
      const text = String(args["text"] ?? args["comment"] ?? "");
      const story = await addComment(client, task.gid, text);
      return { id: story.gid, task: { id: task.gid, name: task.name }, text: story.text };
    }

    case "projects": {
      const projects = await listProjects(client);
      return projects.map((p) => ({ id: p.gid, name: p.name }));
    }

    case "sections": {
      const projectRef = String(args["project"] ?? args["_"] ?? "");
      const project = await resolveProjectRef(client, projectRef);
      const sections = await listSections(client, project.gid);
      return sections.map((s) => ({ id: s.gid, name: s.name }));
    }

    case "tags": {
      const tags = await listTags(client);
      return tags.map((t) => ({ id: t.gid, name: t.name }));
    }

    default:
      sdkError(
        `Unknown batch command "${command}".`,
        "BATCH_PLAN_INVALID",
        `Supported commands: add, complete, reopen, delete, update, show, list, today, inbox, search, completed, comment-add, projects, sections, tags.`,
      );
  }
}

// ── Command ──────────────────────────────────────────────────────────

export const batch = define({
  name: "batch",
  description: "Execute ordered SDK steps from a JSON plan (no child-process spawning)",
  args: {
    file: {
      type: "string" as const,
      description: "Path to plan JSON file",
      required: true,
    },
    "stop-on-error": {
      type: "boolean" as const,
      description: "Stop at first failed step",
    },
    continue: {
      type: "boolean" as const,
      description: "Continue executing after failed steps",
    },
  },
  run: (ctx) =>
    withErrorHandler("batch", async () => {
      const client = getCliClient();
      const raw = await readFile(String(ctx.values.file), "utf8");
      const steps = parsePlan(raw);
      const stopOnError = Boolean(ctx.values["stop-on-error"] || !ctx.values["continue"]);

      const results = await runBatch(client, steps, sdkDispatch, { stopOnError });

      const failed = results.filter((r) => !r.ok).length;

      ok("batch", {
        mode: stopOnError ? "stop-on-error" : "continue",
        summary: {
          total_steps: steps.length,
          executed_steps: results.length,
          success_count: results.length - failed,
          error_count: failed,
          ok: failed === 0,
        },
        steps: results.map((r, index) => ({
          step: index,
          ok: r.ok,
          command: r.command,
          result: r.result,
          error: r.error,
          fix: r.fix,
        })),
      });
    }),
});
