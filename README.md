# asana-cli

Agent-first Asana CLI. HATEOAS JSON responses, `agent-secrets` auth, ref resolution by name/URL/GID.

## Why This Exists

Asana has a rich web UI and official client libraries — great for humans and traditional integrations.

This CLI is for **agents**. Every response is structured JSON with `next_actions` hints (HATEOAS), so an LLM knows what it can do next without reading a man page. Auth flows through `agent-secrets` with TTL-scoped leases. No chalk, no spinners, no prompts — just parseable output.

| | Asana Web / SDK | `asana-cli` (this) |
|---|---|---|
| **Audience** | Humans / traditional apps | AI agents, gateway daemons, tool calls |
| **Output** | Web UI / raw API JSON | HATEOAS JSON with `next_actions` |
| **Auth** | OAuth / PAT | `ASANA_ACCESS_TOKEN` env var or `agent-secrets` lease |
| **Ref resolution** | GID only | Name, URL, `id:xxx`, raw GID |
| **Comments** | Full CRUD (Stories) | ✅ Add + list |
| **Tasks** | Full CRUD | ✅ Full CRUD |
| **Projects / Sections** | Full CRUD | ✅ List + create |
| **Tags** | Full CRUD | ✅ List |
| **Dependencies** | `asana` SDK (superagent) | Zero runtime deps (uses `fetch`) |
| **Runtime** | Node.js | Bun |

**Use the Asana web app or SDK** if you're a human or building a traditional integration.
**Use this CLI** if you're an agent calling tools in a pipeline.

## Install

**From source** (requires [Bun](https://bun.sh)):

```bash
git clone https://github.com/sanurb/asana-cli.git
cd asana-cli
bun install
bun link
```

**Build standalone binary**:

```bash
bun build --compile src/cli.ts --outfile asana-cli
```

**One-liner** (downloads prebuilt binary from GitHub Releases):

```bash
curl -fsSL https://raw.githubusercontent.com/sanurb/asana-cli/main/install.sh | bash
```

Detects OS/arch, installs to `/usr/local/bin`. Override with `ASANA_CLI_DIR`:

```bash
curl -fsSL https://raw.githubusercontent.com/sanurb/asana-cli/main/install.sh | ASANA_CLI_DIR=~/.local/bin bash
```

## Auth

```bash
# Option 1: env var
export ASANA_ACCESS_TOKEN="0/your-token-here"

# Option 2: agent-secrets (auto-leased with TTL)
secrets add asana_access_token

# Create a token at: https://app.asana.com/0/developer-console
```

## Usage

All `<ref>` args accept: **task name**, **Asana URL**, **`id:xxx`**, or **raw GID**.
Project args (`--project`) accept project name or GID.

```bash
# Tasks
asana-cli today                                        # due today + overdue
asana-cli inbox                                        # My Tasks (incomplete)
asana-cli search "deploy pipeline"                     # search by name in My Tasks
asana-cli list --project "Agent Work"                  # tasks in project (by name)
asana-cli show "Ship media pipeline"                   # task detail + comments (stories)
asana-cli add "Ship the media pipeline" --due_on 2026-02-22 --project "Agent Work"
asana-cli complete "Ship the media pipeline"           # by name
asana-cli update "Ship the media pipeline" --due_on 2026-03-01
asana-cli move "Ship the media pipeline" --project "Done"
asana-cli delete "Ship the media pipeline"
asana-cli reopen <ref>

# Comments (Stories — critical for async agent conversations)
asana-cli comments "Ship media pipeline"               # list stories on task
asana-cli comment-add "Ship media pipeline" --content "Started implementation"

# Completed
asana-cli completed --since 2026-02-17                 # completed tasks

# Organization
asana-cli review                                       # daily dashboard
asana-cli projects                                     # list all projects
asana-cli sections --project "Agent Work"              # sections by project name
asana-cli tags                                         # list all tags
asana-cli add-project "New Project"
asana-cli add-section "Backlog" --project "Agent Work"
```

## Output Format

Every response is JSON:

```json
{
  "ok": true,
  "command": "asana-cli complete",
  "result": {
    "completed": {
      "id": "1234567890",
      "name": "Ship the media pipeline",
      "completed": true
    }
  },
  "next_actions": [
    { "command": "asana-cli today", "description": "View remaining today tasks" }
  ]
}
```

Errors:

```json
{
  "ok": false,
  "command": "asana-cli complete",
  "error": {
    "message": "Ambiguous task \"deploy\". Matches: \"Deploy pipeline\" (id:123), \"Deploy worker\" (id:456)",
    "code": "AMBIGUOUS_REF"
  },
  "fix": "Use the exact id: prefix to disambiguate, e.g. id:123",
  "next_actions": [
    { "command": "asana-cli --help", "description": "Show available commands" }
  ]
}
```
