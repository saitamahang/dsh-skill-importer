<div align="center">
  <img src="assets/social-preview.jpg" alt="dsh-skill-importer — 安全迁移 Agent Skills" width="100%" />

  <br />

  <strong>把技能管理带进 DeepSeek Harness Web UI。</strong><br />
  在 DeepSeek Harness、Claude Code、Codex 等 AI 编程 Agent 之间导入、校验、去重和迁移技能。<br />
  无需会话、不耗模型 Token、没有审批往返，导入后立即可用。

  <br /><br />

  [![npm](https://img.shields.io/npm/v/dsh-skill-importer?style=flat-square&color=5dd8bd&label=npm)](https://www.npmjs.com/package/dsh-skill-importer)
  [![downloads](https://img.shields.io/npm/dm/dsh-skill-importer?style=flat-square&color=6da8ff)](https://www.npmjs.com/package/dsh-skill-importer)
  [![DeepSeek Harness](https://img.shields.io/badge/DeepSeek_Harness-%E2%89%A50.1.0--rc.6-5965f2?style=flat-square)](https://github.com/deepseek-ai/deepseek-harness)
  [![license](https://img.shields.io/badge/license-MIT-a786ff?style=flat-square)](LICENSE)

  <br />

  [English](README.md) · **简体中文** · [安装](#安装) · [工作原理](#工作原理) · [开发](#开发)
</div>

---

## 你的技能库，一键即达

`dsh-skill-importer` 是 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的轻量技能管理插件。它把技能变成 Web UI 的一等公民：从本地或 URL 导入 Markdown、查看每一份已安装副本，并在输入框中自然调用，全程不打断工作流。

| 导入 | 管理 | 调用 |
| :--- | :--- | :--- |
| 上传 `SKILL.md`、粘贴 URL，或从 Claude Code、Codex 等 Agent 的技能目录完整迁移。 | 按项目和全局目录分组查看，每个副本都能独立删除。 | 使用输入框选择器、运行 `/skills`，或直接输入 `/skill-name`。 |

### 实际使用效果

| `/skills` 命令 | 输入框技能选择器 |
| :---: | :---: |
| <img src="assets/screenshots/skills-command.png" alt="从 /skills 命令中选择技能" width="100%" /> | <img src="assets/screenshots/composer-picker.png" alt="从输入框下方的技能选择器中选择技能" width="100%" /> |
| 无需离开输入框，直接从命令面板选择技能。 | 从输入框下方打开技能库，一键插入所选技能。 |

### 为高速工作流而生

- **无需 Agent 或会话** — host 进程直接写入技能文件。
- **零模型 Token** — 导入过程不会进入模型上下文。
- **即时发现** — 文件落盘后由 harness watcher 热刷新。
- **工作区感知** — 项目技能始终写入当前注册工作区。
- **中英双语** — UI 文案自动跟随 harness 语言。
- **安全边界清晰** — 固定技能目录、256 KB 限制、同源 POST 校验。

### 带完整预检的批量迁移

第三个导入入口支持选择 `~/.claude/skills`、`~/.codex/skills` 或其他 `.agents/skills` 目录。写入前会扫描并校验每个 `SKILL.md`，同时完整保留技能的 `scripts`、`references`、`assets` 等资源；不合规项只展示错误，绝不会写入目标目录。

目标中存在同名技能时默认跳过。用户可逐项勾选「替换」，检查新增、替换和跳过数量后再确认。每个技能先复制到目标根目录下的临时目录；替换时会暂存旧版本，交换失败自动回滚。扫描结果只能提交一次、十分钟后过期，并在提交时重新核对源内容摘要。

## 三种自然的技能入口

1. **输入框选择器** — 点击权限模式旁边的 pill，按名称搜索并选中。
2. **`/skills` 命令** — 像使用 `/model` 一样打开技能命令面板。
3. **直接调用** — 输入 `/skill-name`，继续你的工作。

三种入口最终都会在输入框填入同一个高亮的 `/name ` 手势；发送后由 dsh 原生流程注入技能指令。

## 安装

### 首次安装

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-skill-importer@latest
```

插件通过 `dsh.bundle` 自动注册到 Web profile，无需手动修改 `cordis.patch.yml`。

安装完成后重启 dsh Web：

```sh
npx @deepseek-ai/dsh web
```

### 更新到最新版

已安装用户执行同一条命令即可更新：

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-skill-importer@latest
```

更新只会替换插件包，不会删除 `.agents/skills` 中的项目技能或 `~/.dsh/skills` 中的全局技能。更新后请重启 dsh Web。

查看 npm 上的最新版本：

```sh
npm view dsh-skill-importer version
```

查看 Web profile 中已安装的插件：

```sh
npx @deepseek-ai/dsh plugin --profile web list
```

#### 新版本的安全等待期

DSH profile 使用 pnpm 管理插件。pnpm 会按 `minimumReleaseAge` 暂缓安装刚发布的版本；在等待期内，`@latest` 可能仍解析到上一个已成熟版本。这是供应链保护机制，不是下载失败。推荐等待 profile 配置的时间窗口结束后，再执行上面的 `@latest` 命令。

`0.x` 版本还遵循特殊的 semver 范围：例如 `^0.1.2` 不包含 `0.2.0`。跨 minor 更新时可在等待期结束后明确指定目标版本：

```sh
npx @deepseek-ai/dsh plugin --profile web add dsh-skill-importer@X.Y.Z
```

如果已经核验该版本并且必须立即安装，可在 `$DSH_HOME/profiles/web/pnpm-workspace.yaml` 中为这个**精确版本**添加临时信任例外，再执行精确版本命令：

```yaml
minimumReleaseAgeExclude:
  - dsh-skill-importer@X.Y.Z
```

将两处 `X.Y.Z` 替换为同一个目标版本。这会绕过该版本的供应链等待期，不建议把包名永久加入例外列表。版本成熟后可以删除这条例外。

打开 **设置 → 技能**，选择 Markdown 文件、粘贴 URL，或通过「批量导入」迁移其他 Agent 的完整技能目录，再选择目标范围。文件系统 watcher 发现后，技能会立即出现。

> 需要 DeepSeek Harness `>= 0.1.0-rc.6`。

### 旧配置导致重复插件

如果启动时报错 `duplicate loader entry id: skill-importer`，说明 profile 中还保留了旧版手动配置。请从 `$DSH_HOME/profiles/web/cordis.patch.yml` 删除手动添加的 `skill-importer` 条目，再重启 dsh Web。当前版本会自动注册，不需要保留该条目。

## 工作原理

dsh 的 client→host RPC 是固定白名单，没有文件写入通道。本插件使用 [`dsh-host-webserver`](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/host/webserver) 提供的官方 `ctx.webServer.register` 扩展点，在 harness 自身服务器上注册同源 `/skill-importer/*` 路由。

```text
Markdown 文件或 URL
        │  同源 fetch
        ▼
/skill-importer/import
        │  host 文件系统写入
        ▼
<skill-root>/<name>/SKILL.md
        │  watcher 事件
        ▼
skills/change → 热刷新
```

所有 POST 路由都会校验 `Origin`，仅接受 loopback 来源（`127.0.0.1` 或 `localhost`）。写入范围固定为两个标准目录：

| 范围 | 目录 |
| :--- | :--- |
| 项目 | `.agents/skills` |
| 全局 | `~/.dsh/skills` |

## 开发

```sh
npm install
npm run build
```

| 模块 | 源码 |
| :--- | :--- |
| Host 插件与路由注册 | `src/index.ts` |
| 文件系统、URL 导入与 HTTP 逻辑 | `src/server.ts` |
| Host/client 共享类型 | `src/types.ts` |
| 浏览器插件与 `/skills` 命令 | `src/client/index.ts` |
| 输入框技能选择器 | `src/client/SkillsPicker.tsx` |
| 设置页 | `src/client/SkillImporterSection.tsx` |

路由一览：`GET /skill-importer/health` · `GET /skill-importer/list` · `POST /skill-importer/import` · `POST /skill-importer/import-url` · `POST /skill-importer/delete` · `POST /skill-importer/batch/scan` · `POST /skill-importer/batch/commit`

### 本地源码安装

```sh
npm install
npm run build
dsh plugin --profile web add /path/to/dsh-skill-importer
```

如果没有全局 `dsh` 命令，可将最后一行替换为 `npx @deepseek-ai/dsh plugin --profile web add /path/to/dsh-skill-importer`。插件会自动注册，随后重启 dsh Web 即可。

## 注意事项

- 单个导入文件最大 256 KB。
- 批量导入接受任意 Agent 中名为 `skills` 的目录（例如 `.claude/skills`、`.codex/skills`、项目自定义的 `agent/skills`）或其中的单个技能目录；每次最多扫描 200 个技能，单个技能最多包含 2,000 个文件和 10 MB 资源，不接受符号链接。
- URL 导入仅支持 HTTPS，并拒绝本机、私有网络、链路本地和保留地址；每次重定向都会重新校验。`.md` 会原样保留，HTML 页面仅做轻量正文提取，因此推荐使用 Markdown 直链。
- 导入后列表会短暂轮询（每 2 秒一次，最多 20 秒）；外部改动可点击 **刷新** 立即同步。

## License

基于 [MIT License](LICENSE) 开源。
