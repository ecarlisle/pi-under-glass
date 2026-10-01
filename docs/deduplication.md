# Deduplication policy

**Use when:** Agent/harness support, or adding a skill

Every coding agent and harness reads its instructions and skills from one shared source, never a per-tool copy:

- **Instructions**: `AGENTS.md` is the single source of truth. A tool that expects its own instruction file (`CLAUDE.md`, `.github/copilot-instructions.md`, `.gemini/settings.json`, ...) gets a thin pointer back to `AGENTS.md`, not a duplicated copy.
- **Skills**: all skills live once, in a single shared directory (e.g. `.agents/skills/`). A tool that looks for skills in its own directory (`.claude/skills`, `.codex/skills`, ...) gets a symlink to that shared directory, never a copied-in directory.

Use native discovery when available. When adding support for a tool that needs a compatibility shim, add a pointer/symlink following this pattern rather than writing separate content — including when a tool (e.g. a skill's own installer) tries to auto-vendor a copy into its own directory.
