#!/usr/bin/env bun
/**
 * asana-cli — Agent-first Asana CLI
 *
 * HATEOAS JSON responses. Bearer token auth via env or agent-secrets.
 * Zero runtime deps beyond gunshi — raw fetch() against Asana REST API.
 */

import { cli, define } from "gunshi";
import { ok, fatal } from "./output.ts";

import { today, inbox, search, list, show, review, completed } from "./commands/task-query.ts";
import { add, complete, reopen, delete as deleteCmd, update, move } from "./commands/task-crud.ts";
import { comments, commentAdd } from "./commands/comments.ts";
import { projects, sections, tags, addProject, addSection } from "./commands/org.ts";

// ── Command tree for self-documenting root ──────────────────────────

const COMMAND_TREE = [
  { name: "today", description: "Tasks due today + overdue (assignee: me)", usage: "asana-cli today" },
  { name: "inbox", description: "My Tasks — incomplete, assigned to me", usage: "asana-cli inbox" },
  { name: "search", description: "Search tasks by name in workspace", usage: "asana-cli search <query>" },
  { name: "list", description: "List tasks (by project or assignee: me)", usage: "asana-cli list [--project <name>] [--section <gid>]" },
  { name: "show", description: "Task detail + comments", usage: "asana-cli show <ref>" },
  { name: "add", description: "Create a new task", usage: "asana-cli add <name> [--due_on <date>] [--project <name>] [--description <text>]" },
  { name: "complete", description: "Mark a task as complete", usage: "asana-cli complete <ref>" },
  { name: "reopen", description: "Reopen a completed task", usage: "asana-cli reopen <ref>" },
  { name: "update", description: "Update task fields", usage: "asana-cli update <ref> [--name <name>] [--due_on <date>] [--description <text>]" },
  { name: "move", description: "Move task to project/section/parent", usage: "asana-cli move <ref> [--project <name>] [--section <gid>] [--parent <gid>]" },
  { name: "delete", description: "Delete a task permanently", usage: "asana-cli delete <ref>" },
  { name: "comments", description: "List comments on a task", usage: "asana-cli comments <ref>" },
  { name: "comment-add", description: "Add a comment to a task", usage: "asana-cli comment-add <ref> --content <text>" },
  { name: "review", description: "Dashboard: today, inbox, overdue, projects", usage: "asana-cli review" },
  { name: "completed", description: "List completed tasks", usage: "asana-cli completed [--since <date>] [--project <name>] [--limit <n>]" },
  { name: "projects", description: "List all projects in workspace", usage: "asana-cli projects" },
  { name: "sections", description: "List sections in a project", usage: "asana-cli sections --project <name>" },
  { name: "tags", description: "List all tags in workspace", usage: "asana-cli tags" },
  { name: "add-project", description: "Create a new project", usage: "asana-cli add-project <name>" },
  { name: "add-section", description: "Create a section in a project", usage: "asana-cli add-section <name> --project <name>" },
];

function printRootHelp() {
  ok("help", {
    version: "0.1.0",
    description: "Agent-first Asana CLI with HATEOAS JSON responses",
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

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
  printRootHelp();
  process.exit(0);
}

// ── Entry ───────────────────────────────────────────────────────────

const entry = define({
  name: "asana-cli",
  description: "Agent-first Asana CLI with HATEOAS JSON responses",
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
  version: "0.1.0",
  description: "Agent-first Asana CLI with HATEOAS JSON responses",
  subCommands: {
    today,
    inbox,
    search,
    list,
    show,
    review,
    completed,
    add,
    complete,
    reopen,
    delete: deleteCmd,
    update,
    move,
    comments,
    "comment-add": commentAdd,
    projects,
    sections,
    tags,
    "add-project": addProject,
    "add-section": addSection,
  },
  renderHeader: null,
  renderValidationErrors: async (ctx, error) => {
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
