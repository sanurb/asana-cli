---
name: asana
description: "Manage Asana tasks, projects, comments (stories), and activity via the asana-cli agent CLI. Use when: 'add a task', 'what's due today', 'check my tasks', 'complete a task', 'asana', 'task list', 'what did I finish', 'add a comment', 'daily review', 'search tasks', 'move task to project', 'what's overdue', or any task management request. All output is HATEOAS JSON with next_actions — parse result.tasks, result.comments, etc."
---

# Asana CLI (asana-cli)

Agent-first Asana CLI. All output is structured JSON with `next_actions` hints.

## Auth

Token resolves automatically: `ASANA_ACCESS_TOKEN` env var → `secrets lease asana_access_token` (agent-secrets).

Create a token at: https://app.asana.com/0/developer-console

## Ref Resolution

All `<ref>` args accept: **task name** (fuzzy matched), **Asana URL**, **`id:xxx`**, or **raw GID**.
Project args (`--project`) also resolve by name.

```bash
asana-cli complete "Buy milk"                              # by name
asana-cli show https://app.asana.com/0/0/123456789        # by URL
asana-cli show id:123456789                                # by id: prefix
```

Ambiguous matches return an error listing candidates with GIDs.

## Workspace

Commands use the **default workspace** (first workspace in the authenticated user's list). All task queries are scoped to this workspace.

## Commands

### Daily Workflow

```bash
asana-cli today                         # tasks due today + overdue (assignee: me)
asana-cli inbox                         # My Tasks (incomplete, assignee: me)
asana-cli review                        # full dashboard: today, inbox, overdue, floating, project breakdown
```

### Search & Browse

```bash
asana-cli search "deploy"               # search by task name (in My Tasks)
asana-cli list                          # My Tasks (assignee: me)
asana-cli list --project "Agent Work"   # by project name
asana-cli list --project "Work" --section <section_gid>
asana-cli show <ref>                    # task detail + comments (stories)
```

### Task CRUD

```bash
asana-cli add "Ship media pipeline" --due_on 2026-02-22 --project "Agent Work"
asana-cli add "Buy groceries" --due_on 2026-02-28 --tags "errands,home"
asana-cli add "Sub-task" --parent <task_gid>
asana-cli complete <ref>
asana-cli reopen <ref>
asana-cli update <ref> --name "New title" --due_on 2026-03-01
asana-cli move <ref> --project "Done"
asana-cli delete <ref>
```

Add flags: `--due_on YYYY-MM-DD`, `--project NAME`, `--section GID`, `--parent GID`, `--tags a,b`, `--description`.

### Comments (Stories)

Critical for agent ↔ human async threads on tasks. In Asana, comments are **stories** on a task.

```bash
asana-cli comments <ref>                              # list stories on a task
asana-cli comment-add <ref> --content "Started work"  # add a comment
```

### Completed & History

```bash
asana-cli completed                                   # completed tasks (assignee: me)
asana-cli completed --since 2026-02-17                # completed since date
asana-cli completed --project "Agent Work" --limit 20
```

### Organization

```bash
asana-cli projects                                    # list all projects (default workspace)
asana-cli sections --project "Agent Work"             # sections by project name
asana-cli tags                                        # list all tags in workspace
asana-cli add-project "New Project"
asana-cli add-section "Backlog" --project "Agent Work"
```

## Output Format

Every response:

```json
{
  "ok": true,
  "command": "asana-cli <cmd>",
  "result": { ... },
  "next_actions": [
    { "command": "asana-cli ...", "description": "..." }
  ]
}
```

Errors: `{ "ok": false, "error": "message" }`.

Parse `result.tasks[].id` for GIDs, `result.count` for totals, `next_actions` for what to do next.

## Common Agent Patterns

### Morning Review
```bash
asana-cli review    # get full dashboard, triage My Tasks, check overdue
```

### Capture from Conversation
When user mentions something actionable:
```bash
asana-cli add "Deploy the media pipeline" --due_on 2026-02-22 --project "Agent Work"
```

### Async Agent Thread
Agent leaves a question as a comment, user replies later:
```bash
asana-cli comment-add "Deploy pipeline" --content "Should I deploy to staging first, or straight to prod?"
# ... later ...
asana-cli comments "Deploy pipeline"   # check for user's reply
```

### Weekly Retrospective
```bash
asana-cli completed --since 2026-02-12
```
