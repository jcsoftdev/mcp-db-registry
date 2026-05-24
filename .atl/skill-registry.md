# Skill Registry — db-registry

**Delegator use only.** Any agent that launches sub-agents reads this registry to resolve compact rules, then injects them directly into sub-agent prompts. Sub-agents do NOT read this registry or individual SKILL.md files.

Generated: 2026-05-23
Project: db-registry
Stack: Bun + TypeScript + @modelcontextprotocol/sdk (multi-engine: postgres, mysql, mongo, redis, sqlite)

## User Skills

| Trigger | Skill | Path |
|---------|-------|------|
| When creating a pull request, opening a PR, or preparing changes for review | branch-pr | /Users/machine/.claude/skills/branch-pr/SKILL.md |
| When writing Go tests, using teatest, or adding test coverage | go-testing | /Users/machine/.claude/skills/go-testing/SKILL.md |
| When creating a GitHub issue, reporting a bug, or requesting a feature | issue-creation | /Users/machine/.claude/skills/issue-creation/SKILL.md |
| When user says "judgment day", "judgment-day", "review adversarial", "dual review", "doble review", "juzgar", "que lo juzguen" | judgment-day | /Users/machine/.claude/skills/judgment-day/SKILL.md |
| When the orchestrator launches you to implement one or more tasks from a change | sdd-apply | /Users/machine/.claude/skills/sdd-apply/SKILL.md |
| When the orchestrator launches you to archive a change after implementation and verification | sdd-archive | /Users/machine/.claude/skills/sdd-archive/SKILL.md |
| When the orchestrator launches you to write or update the technical design for a change | sdd-design | /Users/machine/.claude/skills/sdd-design/SKILL.md |
| When the orchestrator launches you to think through a feature, investigate the codebase, or clarify requirements | sdd-explore | /Users/machine/.claude/skills/sdd-explore/SKILL.md |
| When user wants to initialize SDD in a project, or says "sdd init", "iniciar sdd", "openspec init" | sdd-init | /Users/machine/.claude/skills/sdd-init/SKILL.md |
| When the orchestrator launches you to onboard a user through the full SDD cycle | sdd-onboard | /Users/machine/.claude/skills/sdd-onboard/SKILL.md |
| When the orchestrator launches you to create or update a proposal for a change | sdd-propose | /Users/machine/.claude/skills/sdd-propose/SKILL.md |
| When the orchestrator launches you to write or update specs for a change | sdd-spec | /Users/machine/.claude/skills/sdd-spec/SKILL.md |
| When the orchestrator launches you to create or update the task breakdown for a change | sdd-tasks | /Users/machine/.claude/skills/sdd-tasks/SKILL.md |
| When the orchestrator launches you to verify a completed (or partially completed) change | sdd-verify | /Users/machine/.claude/skills/sdd-verify/SKILL.md |
| When user asks to create a new skill, add agent instructions, or document patterns for AI | skill-creator | /Users/machine/.claude/skills/skill-creator/SKILL.md |
| When user says "update skills", "skill registry", "actualizar skills", "update registry", or after installing/removing skills | skill-registry | /Users/machine/.claude/skills/skill-registry/SKILL.md |

## Compact Rules

Pre-digested rules per skill. Delegators copy matching blocks into sub-agent prompts as `## Project Standards (auto-resolved)`.

### branch-pr
- Every PR MUST link an approved issue — no exceptions
- Branch naming: `^(feat|fix|chore|docs|style|refactor|perf|test|build|ci|revert)\/[a-z0-9._-]+$`
- Every PR MUST have exactly one `type:*` label
- Run shellcheck on any modified shell scripts before opening PR
- Automated checks must pass before merge

### go-testing
- Table-driven tests: use `[]struct{ name, input, expected, wantErr }` pattern
- Bubbletea: test Model state via `.Update(tea.KeyMsg{...})` directly
- Use `teatest` for full TUI lifecycle tests (teatest.NewTestModel)
- Golden files: use `golden.RequireEqual` for snapshot testing
- Always use `t.Run(tt.name, ...)` for subtests

### issue-creation
- Blank issues disabled — MUST use bug report or feature request template
- Every issue gets `status:needs-review` on creation automatically
- Maintainer MUST add `status:approved` before any PR can be opened
- Questions go to Discussions, not issues

### judgment-day
- Launch TWO independent blind judge sub-agents in parallel (never sequential)
- Neither judge knows about the other — no cross-contamination
- Synthesize verdicts: CRITICAL blocks merge, WARNING needs decision, SUGGESTION optional
- Max 2 re-judge iterations before escalating to user
- Resolve skills from registry and inject compact rules into BOTH judge prompts

### skill-creator
- Skill lives at `skills/{skill-name}/SKILL.md` with YAML frontmatter (name, description, trigger, license, metadata.author, version)
- author in frontmatter: `jcsoftdev` for original skills, keep original for third-party
- Include: When to Use, Critical Patterns, Code Examples, Commands sections
- Trigger must be precise enough to avoid false positives
- Don't create skills for trivial or one-off patterns

### Bun + TypeScript (project stack)
- Runtime: Bun (not Node.js). Use `bun test` for all tests — no Jest, Vitest, or Mocha
- Module system: ESM (`"type": "module"` in package.json). All imports use `.ts` extensions
- Types: `@types/bun` available. No tsconfig detected — Bun handles TS natively
- No linter or formatter config detected (no biome.json, eslint, prettier)
- SQLite: use `bun:sqlite` built-in (no better-sqlite3 or similar needed)

### MCP Server Pattern (db-registry)
- Entry: `src/server.ts` — scaffold only, implementation pending
- Transport: `@modelcontextprotocol/sdk` — follow MCP tool/resource/prompt patterns
- Engines: postgres, mysql, mongo, redis, sqlite — all via generic `engine` param
- Deps: postgres, mysql2, mongodb, ioredis, bun:sqlite, @noble/ciphers, yaml, @clack/prompts
- Encryption: XChaCha20-Poly1305 via `@noble/ciphers` for credentials + snippet bodies
- Read-only by default; writes gated by `DB_REGISTRY_ALLOW_WRITE=1`
- Architecture mirrors port-registry sibling (same installer layout, same deps pattern)

### Testing (db-registry)
- Framework: Bun built-in test runner (`bun test`)
- Test files: `tests/*.test.ts` pattern
- Strict TDD: ENABLED — write tests before implementation
- Coverage: `bun test --coverage`

### Authorship
- Author: `jcsoftdev` (all original files). Never use `gentleman-programming` for project code
- Commits: conventional commits, no Co-Authored-By or AI attribution

### Shell Tools
- Use: `eza`, `bat`, `rg`, `fd`, `sd` — never `ls`, `cat`, `grep`, `find`, `sed`
- Never auto-build after changes

## Project Conventions

| File | Path | Notes |
|------|------|-------|
| — | — | No project-level CLAUDE.md, AGENTS.md, or .cursorrules found |
