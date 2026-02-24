#!/usr/bin/env bun
/**
 * asana-cli — Agent-first Asana CLI
 *
 * HATEOAS JSON responses. Bearer token auth via env or agent-secrets.
 * Zero runtime deps beyond gunshi — raw fetch() against Asana REST API.
 */

import { cli, define } from "gunshi";
import { ok, fatal } from "./output.ts";
import { parseGlobalCliContext } from "./lib/asana/cli-context";
import pkg from "../package.json" with { type: "json" };

const VERSION = pkg.version;
const DESCRIPTION = pkg.description ?? "Agent-first Asana CLI with HATEOAS JSON responses";

import { today, inbox, search, list, show, review, completed } from "./commands/task-query.ts";
import { add, complete, reopen, delete as deleteCmd, update, move, projectAdd, projectRemove } from "./commands/task-crud.ts";
import { comments, commentAdd, commentUpdate, commentDelete, commentLast } from "./commands/comments.ts";
import { projects, sections, tags, addProject, addSection, sectionsMove } from "./commands/org.ts";
import { workspaces, users } from "./commands/workspace-users.ts";
import { subtasks, subtaskAdd } from "./commands/subtasks.ts";
import { customFields } from "./commands/custom-fields.ts";
import { deps, depAdd, depRemove } from "./commands/dependencies.ts";
import { attachments, attachLink } from "./commands/attachments.ts";
import { batch } from "./commands/batch.ts";

type EnvelopeError = {
  readonly ok: false;
  readonly command: string;
  readonly error: {
    readonly message: string;
    readonly code: string;
  };
  readonly fix: string;
  readonly next_actions: readonly unknown[];
};

function isEnvelopeError(value: unknown): value is EnvelopeError {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const err = record.error as Record<string, unknown> | undefined;
  return (
    record.ok === false &&
    typeof record.command === "string" &&
    typeof err?.message === "string" &&
    typeof err?.code === "string" &&
    typeof record.fix === "string" &&
    Array.isArray(record.next_actions)
  );
}

// ── Command tree for self-documenting root ──────────────────────────

const COMMAND_TREE = [
  { name: "today", description: "Tasks due today + overdue (assignee: me)", usage: "asana-cli today" },
  { name: "workspaces", description: "List accessible workspaces", usage: "asana-cli workspaces" },
  { name: "users", description: "List/search users in workspace", usage: "asana-cli users [--workspace <ref>] [--query <q>]" },
  { name: "inbox", description: "My Tasks — incomplete, assigned to me", usage: "asana-cli inbox" },
  { name: "search", description: "Search tasks by name in workspace", usage: "asana-cli search <query>" },
  { name: "list", description: "List tasks (by project or assignee: me)", usage: "asana-cli list [--project <name>] [--section <gid>]" },
  { name: "show", description: "Task detail + comments", usage: "asana-cli show <ref>" },
  { name: "add", description: "Create a new task", usage: "asana-cli add <name> [--assignee <me|email|gid>] [--cf \"Field=Value\"]..." },
  { name: "complete", description: "Mark a task as complete", usage: "asana-cli complete <ref>" },
  { name: "reopen", description: "Reopen a completed task", usage: "asana-cli reopen <ref>" },
  { name: "update", description: "Update task fields", usage: "asana-cli update <ref> [--assignee <me|email|gid>] [--cf \"Field=Value\"]..." },
  { name: "move", description: "Move task to project/section/parent", usage: "asana-cli move <ref> [--project <name>] [--section <gid>] [--parent <gid>]" },
  { name: "project-add", description: "Add task to project (multi-home)", usage: "asana-cli project-add <task-ref> --project <ref>" },
  { name: "project-remove", description: "Remove task from project", usage: "asana-cli project-remove <task-ref> --project <ref>" },
  { name: "subtasks", description: "List direct or deep subtasks", usage: "asana-cli subtasks <task-ref> [--deep]" },
  { name: "subtask-add", description: "Create a subtask", usage: "asana-cli subtask-add <parent-ref> --name <name> [--due_on <date>] [--assignee <ref>]" },
  { name: "deps", description: "Inspect dependency edges", usage: "asana-cli deps <task-ref> [--direction blocked_by|blocking|both]" },
  { name: "dep-add", description: "Add dependency edge", usage: "asana-cli dep-add <task-ref> --blocked-by <task-ref>" },
  { name: "dep-remove", description: "Remove dependency edge", usage: "asana-cli dep-remove <task-ref> --blocked-by <task-ref>" },
  { name: "attachments", description: "List task attachments", usage: "asana-cli attachments <task-ref>" },
  { name: "attach-link", description: "Attach external URL to task", usage: "asana-cli attach-link <task-ref> --url <https://...> [--name <title>]" },
  { name: "custom-fields", description: "List project custom fields", usage: "asana-cli custom-fields --project <ref>" },
  { name: "delete", description: "Delete a task permanently", usage: "asana-cli delete <ref>" },
  { name: "comments", description: "List comments on a task", usage: "asana-cli comments <ref>" },
  { name: "comment-add", description: "Add a comment to a task", usage: "asana-cli comment-add <ref> --content <text>" },
  { name: "comment-update", description: "Update a comment", usage: "asana-cli comment-update <task-ref> --story <id> --content <text>" },
  { name: "comment-delete", description: "Delete a comment", usage: "asana-cli comment-delete <task-ref> --story <id>" },
  { name: "comment-last", description: "Update last comment by actor", usage: "asana-cli comment-last <task-ref> --by me --update <text>" },
  { name: "review", description: "Dashboard: today, inbox, overdue, projects", usage: "asana-cli review" },
  { name: "completed", description: "List completed tasks", usage: "asana-cli completed [--since <date>] [--project <name>] [--limit <n>]" },
  { name: "projects", description: "List all projects in workspace", usage: "asana-cli projects" },
  { name: "sections", description: "List sections in a project", usage: "asana-cli sections --project <name>" },
  { name: "tags", description: "List all tags in workspace", usage: "asana-cli tags" },
  { name: "add-project", description: "Create a new project", usage: "asana-cli add-project <name>" },
  { name: "add-section", description: "Create a section in a project", usage: "asana-cli add-section <name> --project <name>" },
  { name: "sections move", description: "Move task between sections with ordering", usage: "asana-cli sections move <task-ref> --project <ref> --section <ref> [--before <task-ref>|--after <task-ref>]" },
  { name: "batch", description: "Execute ordered plan file", usage: "asana-cli batch --file <plan.json> [--stop-on-error|--continue]" },
];

function printRootHelp() {
  ok("help", {
    version: VERSION,
    description: DESCRIPTION,
    auth: "ASANA_ACCESS_TOKEN env var or 'secrets lease asana_access_token'",
    ref_formats: [
      "Task/project name (fuzzy matched)",
      "Asana URL: https://app.asana.com/0/<project>/<task>",
      "Explicit ID: id:<gid>",
      "Raw numeric GID",
    ],
    commands: COMMAND_TREE,
  }, [
    { command: "asana-cli today", description: "See what's due today" },
    { command: "asana-cli inbox", description: "List all incomplete tasks" },
    { command: "asana-cli review", description: "Full dashboard overview" },
    {
      command: "asana-cli search <query>",
      description: "Search tasks by name",
      params: { query: { required: true, description: "Search term" } },
    },
  ]);
}

// ── Early exit for root / help ──────────────────────────────────────
// Bypass gunshi for no-args and --help to avoid plain text output.

const parsed = parseGlobalCliContext(process.argv.slice(2));
const args = parsed.args;
if (args[0] === "sections" && args[1] === "move") {
  args.splice(0, 2, "sections-move");
}
if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
  printRootHelp();
  process.exit(0);
}

// ── Entry ───────────────────────────────────────────────────────────

const entry = define({
  name: "asana-cli",
  description: DESCRIPTION,
  args: {},
  run: (ctx) => {
    if (ctx.omitted) {
      printRootHelp();
    }
  },
});

try {
await cli(args, entry, {
  name: "asana-cli",
  version: VERSION,
  description: DESCRIPTION,
  subCommands: {
    workspaces,
    users,
    today,
    inbox,
    search,
    list,
    show,
    review,
    completed,
    add,
    "subtask-add": subtaskAdd,
    subtasks,
    complete,
    reopen,
    delete: deleteCmd,
    update,
    move,
    "project-add": projectAdd,
    "project-remove": projectRemove,
    deps,
    "dep-add": depAdd,
    "dep-remove": depRemove,
    attachments,
    "attach-link": attachLink,
    "custom-fields": customFields,
    comments,
    "comment-add": commentAdd,
    "comment-update": commentUpdate,
    "comment-delete": commentDelete,
    "comment-last": commentLast,
    projects,
    sections,
    "sections-move": sectionsMove,
    tags,
    "add-project": addProject,
    "add-section": addSection,
    batch,
  },
  renderHeader: null,
  renderValidationErrors: async (ctx, error: AggregateError) => {
    const messages = error.errors.map((e: Error) => e.message);
    console.error(JSON.stringify({
      ok: false,
      command: `asana-cli ${ctx.name ?? "unknown"}`,
      error: { message: messages.join("; "), code: "INVALID_INPUT" },
      fix: `Run 'asana-cli ${ctx.name} --help' to see required arguments and options.`,
      next_actions: [{ command: "asana-cli --help", description: "Show all available commands" }],
    }));
    process.exit(1);
    return "";
  },
  onErrorCommand: async (ctx, error) => {
    if (isEnvelopeError(error)) {
      console.error(JSON.stringify(error));
      process.exit(1);
    }

    fatal(error.message, {
      code: "COMMAND_FAILED",
      command: ctx.name ?? "unknown",
      fix: `Check the error details and retry. Run 'asana-cli ${ctx.name} --help' for usage.`,
      nextActions: [
        { command: "asana-cli --help", description: "Show all available commands" },
      ],
    });
  },
});
} catch (err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  fatal(message, {
    code: "COMMAND_FAILED",
    fix: "Run 'asana-cli' with no args to see available commands.",
    nextActions: [
      { command: "asana-cli --help", description: "Show all available commands" },
    ],
  });
}
