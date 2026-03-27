# swarm

Autonomous multi-agent coding swarm. One command, infinite commits.

```
npx swarm-agents https://github.com/you/yourrepo
```

Agents pick tasks from GitHub issues, TODO comments, failing tests, and lint errors. They work in parallel in isolated clones, commit changes, push branches, open PRs, and review + merge their own PRs. When the queue drains, they discover new work and keep going.

## Install

```bash
npm install -g swarm-agents
# or just run directly:
npx swarm-agents <repo>
```

## Usage

```bash
# Point at a GitHub repo (uses ANTHROPIC_API_KEY + GITHUB_TOKEN)
npx swarm-agents https://github.com/you/repo

# Local repo, 5 agents, $2 budget per task
npx swarm-agents ./my-project --agents 5 --budget 2

# Dry run — discover tasks without executing
npx swarm-agents https://github.com/you/repo --dry-run

# Run exactly 10 tasks then stop
npx swarm-agents https://github.com/you/repo --max-tasks 10

# No PRs — commit directly
npx swarm-agents ./local-project --no-pr
```

## Options

| Flag | Default | Description |
|------|---------|-------------|
| `-n, --agents N` | 3 | Parallel agent count |
| `--engine` | claude | Coding engine: `claude`, `aider` |
| `--branch` | main | Base branch |
| `--budget USD` | 5 | Max spend per agent per task |
| `--max-tasks N` | ∞ | Stop after N completed tasks |
| `--dry-run` | off | Discover tasks, print, exit |
| `--no-pr` | off | Skip PR creation, commit directly |

## Environment

```bash
ANTHROPIC_API_KEY=sk-ant-...       # Required for claude engine
GITHUB_TOKEN=ghp_...               # Required for GitHub issues + PR creation
SWARM_TOKENS=tok1,tok2,tok3        # Optional: rotate multiple API keys across agents
OPENAI_API_KEY=sk-...              # Required for openai engine
SWARM_VERBOSE=1                    # Show internal agent logs
```

## Task sources (in priority order)

1. **GitHub issues** — open issues on the repo
2. **TODO/FIXME comments** — in `.js`, `.ts`, `.py`, `.go`, `.rs` files
3. **Failing tests** — runs `npm test`, feeds failures as tasks
4. **Lint errors** — runs `npm run lint`, feeds errors as tasks
5. **Synthetic** — when queue is empty: error handling audit, type coverage, test coverage, dead code removal

## Architecture

```
npx swarm <repo>
    │
    ├── Orchestrator
    │     ├── TaskQueue (JSON disk persistence)
    │     ├── TaskDiscovery (issues + todos + tests + lint)
    │     ├── ReviewLoop (background: review + merge open swarm PRs)
    │     └── DiscoveryLoop (background: refill queue every 2m)
    │
    ├── Agent[0] ─── clone → branch → claude subprocess → commit → push
    ├── Agent[1] ─── clone → branch → claude subprocess → commit → push
    └── Agent[N] ─── clone → branch → claude subprocess → commit → push
```

Each agent runs in an isolated temp directory. On task completion: push branch → open PR → reviewer agent approves → squash merge → next task.

## Revenue

- `swarm-agents` npm package (open core, MIT)
- `swarm.run` hosted SaaS: connect GitHub, pay per token consumed
- Plans: $99/mo (1 agent), $299/mo (5 agents), $999/mo (unlimited)
