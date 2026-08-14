<div align="center">
  <img src="assets/hero.svg" alt="dsh-skill-importer — Skills, right where you need them" width="100%" />

  <br />

  <strong>Bring skill management into the DeepSeek Harness Web UI.</strong><br />
  Import, discover, and invoke skills without a session, model tokens, or approval round-trips.

  <br /><br />

  [![npm](https://img.shields.io/npm/v/dsh-skill-importer?style=flat-square&color=5dd8bd&label=npm)](https://www.npmjs.com/package/dsh-skill-importer)
  [![downloads](https://img.shields.io/npm/dm/dsh-skill-importer?style=flat-square&color=6da8ff)](https://www.npmjs.com/package/dsh-skill-importer)
  [![DeepSeek Harness](https://img.shields.io/badge/DeepSeek_Harness-%E2%89%A50.1.0--rc.6-5965f2?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
  [![license](https://img.shields.io/badge/license-MIT-a786ff?style=flat-square)](LICENSE)

  <br />

  **English** · [简体中文](README.zh.md) · [Install](#installation) · [How it works](#how-it-works) · [Development](#development)
</div>

---

## Your skill library, one click away

`dsh-skill-importer` is a lightweight plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`). It turns skills into a first-class part of the Web UI: bring in Markdown from disk or a URL, see every installed copy, and insert a skill into the composer without breaking your flow.

| Import | Organize | Invoke |
| :--- | :--- | :--- |
| Upload `SKILL.md` or paste a URL. Frontmatter is validated and normalized before writing. | Browse skills grouped across project, legacy project, and global roots. Remove any copy individually. | Use the composer picker, run `/skills`, or type `/skill-name` directly. |

### Built for a fast loop

- **No agent or session** — the host writes skill files directly.
- **Zero model tokens** — imports never enter a model context.
- **Instant discovery** — the harness watcher hot-refreshes skills after they land.
- **Workspace-aware** — project skills always target the active registered workspace.
- **Bilingual UI** — English and Chinese copy follows the harness locale.
- **Safe by design** — fixed skill roots, 256 KB limit, and same-origin POST checks.

## Three natural ways to use a skill

1. **Composer picker** — open the pill beside the access-mode selector, search by name, and choose.
2. **`/skills` command** — use a familiar command palette, modeled after `/model`.
3. **Direct invocation** — type `/skill-name` and keep moving.

All three fill the composer with the same highlighted `/name ` gesture; sending injects the skill instructions through dsh's native flow.

## Installation

### 1. Add the plugin to the Web profile

```sh
dsh plugin --profile web add dsh-skill-importer
```

### 2. Enable it in the profile

Add the following entry to `$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
- id: skill-importer
  name: dsh-skill-importer
```

### 3. Restart dsh Web

Open **Settings → Skills**. Import a Markdown file or URL, choose a target, and the skill will appear as soon as the filesystem watcher discovers it.

> Requires DeepSeek Harness `>= 0.1.0-rc.6` via `npx @deepseek-ai/dsh web`.

## How it works

The dsh client-to-host RPC is a fixed allowlist with no file-write channel. This plugin uses the official `ctx.webServer.register` extension point exposed by [`dsh-host-webserver`](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/host/webserver) and registers same-origin `/skill-importer/*` routes on the harness server.

```text
Markdown file or URL
        │  same-origin fetch
        ▼
/skill-importer/import
        │  host filesystem write
        ▼
<skill-root>/<name>/SKILL.md
        │  watcher event
        ▼
skills/change → hot refresh
```

POST routes verify the `Origin` header and only accept loopback sources (`127.0.0.1` or `localhost`). Writes are restricted to these standard roots:

| Scope | Directory |
| :--- | :--- |
| Project | `.agents/skills` |
| Legacy project | `.dsh/skills` |
| Global | `~/.dsh/skills` |

## Development

```sh
npm install
npm run build
```

| Area | Source |
| :--- | :--- |
| Host plugin and route registration | `src/index.ts` |
| Filesystem, URL import, and HTTP logic | `src/server.ts` |
| Shared wire types | `src/types.ts` |
| Browser plugin and `/skills` command | `src/client/index.ts` |
| Composer picker | `src/client/SkillsPicker.tsx` |
| Settings experience | `src/client/SkillImporterSection.tsx` |

Available routes: `GET /skill-importer/health` · `GET /skill-importer/list` · `POST /skill-importer/import` · `POST /skill-importer/import-url` · `POST /skill-importer/delete`

### Local checkout

```sh
npm install
npm run build
dsh plugin --profile web add /path/to/dsh-skill-importer
```

Add the profile entry shown above, then restart dsh Web.

## Notes

- A single imported file may be up to 256 KB.
- URL import preserves `.md` sources; HTML pages use lightweight text extraction, so direct Markdown URLs work best.
- The installed list polls briefly after import (every 2 seconds for up to 20 seconds). **Refresh** syncs external changes immediately.

## License

Released under the [MIT License](LICENSE).
