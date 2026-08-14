# dsh-skill-importer

English | [中文](README.zh.md)

[![npm version](https://img.shields.io/npm/v/dsh-skill-importer)](https://www.npmjs.com/package/dsh-skill-importer)
[![npm downloads](https://img.shields.io/npm/dm/dsh-skill-importer)](https://www.npmjs.com/package/dsh-skill-importer)
[![License: MIT](https://img.shields.io/npm/l/dsh-skill-importer)](LICENSE)

A skill management plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`). Import, list, and delete skills directly from the Web UI — no agent, no session, no model tokens, no approval round-trips. Files land on disk immediately and the harness hot-discovers them.

## Features

- **Three skill entry points** — the `/` menu no longer lists skills directly:
  1. **Composer tool-row picker** (next to the access-mode selector): a pill trigger with a name-filter search box, first-letter avatars, and bare skill names.
  2. **`/skills` command** — modelled on `/model`: a popup list, name-only search, select fills `/name `.
  3. **Type `/name` directly** — the native text gesture, highlighted and injected the same way.
- **Installed list, grouped by location** — every copy in `.agents/skills`, `.dsh/skills`, and `~/.dsh/skills` is shown (no rank hiding on the management surface), with invocation markers and a delete button per copy.
- **Workspace-aware targets** — project skills write into the active registered workspace (never the dsh process's cwd), matching how `/` and the model catalog resolve.
- **Import from file** — pick a Markdown file (`SKILL.md` or `<name>.md`), frontmatter is parsed and validated (`name` kebab-case, `description` required), previewed, then written to `<target>/<name>/SKILL.md`.
- **Import from URL** — the host fetches the URL (`.md` verbatim; HTML roughly extracted to text).
- **Frontmatter normalization** — special characters in descriptions are quoted automatically, so strict-YAML discovery never silently skips a skill.
- **Bilingual UI** — the settings section and picker copy follow the harness's zh/en locale, styled like the General settings rows.

## How it works

dsh's client→host RPC is a hard-coded allowlist with no file-write channel, but [`dsh-host-webserver`](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/host/webserver) exposes the official route-registration extension point (`ctx.webServer.register`). The plugin registers `/skill-importer/*` routes on the harness's own same-origin server:

```
browser reads file / user enters URL
        │ fetch (same origin)
        ▼
host route /skill-importer/import (registered on ctx.webServer)
        │ direct filesystem write (host process permissions — no sandbox, no approval)
        ▼
<target>/<name>/SKILL.md lands
        │
        ▼
skill-filesystem watcher discovers it → skills/change → hot refresh
```

- **No session**: the host process writes; no agent, model, or session involved.
- **No approval**: the host owns user permissions; the agent tool sandbox never applies.
- **Secure**: routes live on the loopback-only server; `POST` routes verify the `Origin` header (only `127.0.0.1`/`localhost` sources pass).

## Requirements

- DeepSeek Harness `>= 0.1.0-rc.6` (`npx @deepseek-ai/dsh web`)

## Installation

### From npm

```sh
# 1. Install the package into the web profile
dsh plugin --profile web add dsh-skill-importer

# 2. Add a row to $DSH_HOME/profiles/web/cordis.patch.yml:
#    - id: skill-importer
#      name: 'dsh-skill-importer'

# 3. Restart dsh web
```

### From a local checkout (development)

```sh
npm install
npm run build
dsh plugin --profile web add /path/to/dsh-skill-importer
# + the cordis.patch.yml row above, then restart dsh web
```

A **Skills** section appears in Settings.

## Usage

1. **Import**: Settings → Skills → pick a Markdown file (or paste a URL) → choose a target directory → Import. The form resets after success; the list refreshes automatically.
2. **Use**: in any session, pick a skill from the tool-row picker, run `/skills`, or type `/name ` — all three fill the draft with `/name ` (highlighted) and sending injects the skill's instructions.

## Development

```sh
npm install
npm run build     # tsc emits lib/types; tsdown emits lib/index.js + lib/client.js
```

Layout:

- `src/index.ts` — host plugin body: registers the `/skill-importer/*` routes (`inject: ['webServer', 'workspaceRegistry']`)
- `src/server.ts` — pure Node logic (write/delete/list/URL fetch/HTTP layer), no Cordis imports, directly smoke-testable
- `src/types.ts` — shared wire types between host and client halves
- `src/client/index.ts` — browser plugin body: settings section, `/skills` popupSelect, hidden lexicon source
- `src/client/SkillsPicker.tsx` — composer tool-row picker (search + avatars)
- `src/client/SkillImporterSection.tsx` — settings section (General-settings row style, zh/en)

Routes: `GET /skill-importer/health` · `GET /skill-importer/list` · `POST /skill-importer/import` · `POST /skill-importer/import-url` · `POST /skill-importer/delete`

## Known limitations

- Single file ≤ 256 KB.
- URL import does a rough text extraction for HTML pages — prefer `.md` sources.
- Targets are fixed to the three standard skill roots (no arbitrary paths; that is the security boundary).
- The list polls briefly after an import (2s interval, up to 20s); Refresh syncs immediately for external changes.

## License

MIT
