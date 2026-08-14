# dsh-skill-importer

DeepSeek Harness 的插件：**直接写盘的技能导入器**。在设置页新增「技能」分区，选中本地 `SKILL.md` 后点击导入，文件**立即写入**目标技能目录——不经过 agent、不需要会话、不需要模型、不消耗 token、无审批。

## 功能

- **技能入口（`/` 菜单不再直接列技能）**：① 输入框工具行技能下拉（权限选择旁边，常驻）；② `/skills` 命令（弹出技能列表，同 `/model` 交互）；③ 手输 `/<名称> `。三者都填入 `/名称 ` 并高亮，发送即注入技能正文：`/` 菜单隐藏技能，输入框工具行出现技能下拉框，选中后自动填入 `/<名称> `，发送即使用对应技能
- **已安装列表**：扫描全部已注册工作区的项目技能根（`.dsh/skills`、`.agents/skills`）加用户技能根（`~/.dsh/skills`），**按安装位置分组展示全部副本**（不按 rank 去重，管理面能看到每一处），每项显示调用策略标记并可直接删除
- **工作区感知**：项目目标写入「当前工作区」（最近活跃的已注册工作区）而非 dsh 进程的启动目录——与 `/` 斜杠菜单的解析一致，导入后立即可见
- **从文件导入**：选择本地 Markdown → 浏览器内解析 frontmatter 并校验（`name` kebab-case、`description` 必填）→ 预览确认 → 直接写入 `<目标>/<name>/SKILL.md`
- **从 URL 导入**：host 进程抓取 URL（`.md` 原样写入；HTML 粗略提取正文），整理为技能文件
- **目标目录选择**：当前工作区 `.agents/skills` / `.dsh/skills` / 用户技能目录 `~/.dsh/skills`

## 设计原理（为什么没有"目标会话"了）

框架的 client→host RPC 是硬编码白名单，没有写文件通道；但 **`dsh-host-webserver` 提供了官方路由注册扩展点**（`ctx.webServer.register`），任何插件都能在 dsh 自己的 Web 服务器（同源）上挂 HTTP 路由：

```
浏览器读文件 / 输入 URL
        │ fetch（同源，无 CORS）
        ▼
host 插件路由 /skill-importer/import（注册在 ctx.webServer 上）
        │ 直接写文件（host 进程自己的权限，无沙箱、无审批）
        ▼
<目标>/<name>/SKILL.md 落地
        │
        ▼
skill-filesystem 的 watcher 发现 → skills/change → / 菜单、模型目录热刷新
```

- **无会话**：写盘由 host 进程完成，与任何会话/agent/模型无关
- **无审批**：host 进程拥有用户权限，不像 agent 工具那样受沙箱约束
- **安全**：路由只监听在 dsh 的 loopback 服务器上；`POST` 会校验 `Origin`（仅放行 `127.0.0.1`/`localhost` 来源，其他网页无法调用）

## 安装

要求 dsh `>= 0.1.0-rc.6`（`npx @deepseek-ai/dsh web` 方式运行）。

### 从 npm 安装（已发布后）

```sh
# 1. 安装插件包（等价于在 profile 里 add）
dsh plugin --profile web add dsh-skill-importer

# 2. 在 $DSH_HOME/profiles/web/cordis.patch.yml 里追加一行：
#    - id: skill-importer
#      name: 'dsh-skill-importer'

# 3. 重启 dsh web
```

### 从本地路径安装（开发中）

```sh
# 1. 构建
npm install
npm run build

# 2. 装进 web profile（本地路径）
dsh plugin --profile web add /path/to/dsh-skill-importer

# 3. 同上在 cordis.patch.yml 追加插件行

# 4. 重启 dsh web
```

设置页左侧导航出现「技能」分区。

## 使用

设置 → 技能 → 导入 → 从文件：选一个 Markdown（带 `name`/`description` frontmatter）→ 预览校验 → 选目标目录 → 点「导入」→ 立即写入并自动刷新列表。之后在会话输入框敲 `/` 即可使用新技能。

## 开发

```sh
npm install
npm run build     # tsc 产出 lib/types，tsdown 产出 lib/index.js + lib/client.js
```

- `src/index.ts`：host 插件体——把四个路由注册到 `ctx.webServer`（`inject: ['webServer']`）
- `src/server.ts`：纯 Node 逻辑（写盘、扫描、URL 抓取、HTTP 层），无 Cordis 依赖，可直接 `node` 冒烟测试
- `src/types.ts`：host/client 共享的线格式类型
- `src/client/index.ts`：浏览器插件体（`settings.section` 注册 + fetch 同源路由）
- `src/client/SkillImporterSection.tsx`：设置页组件（纯展示）

路由一览：`GET /skill-importer/health` · `GET /skill-importer/list` · `POST /skill-importer/import` · `POST /skill-importer/import-url` · `POST /skill-importer/delete`


## 已知限制

- 单文件 ≤ 256 KB
- URL 导入对 HTML 页面只做粗略文本提取，推荐指向 `.md` 文件
- 目标目录固定为三个标准技能根（不支持任意路径，这是安全边界）
- 导入后列表由前端轮询刷新（2 秒间隔，最多 20 秒）；如果目录被外部改动，点「刷新」立即同步

## License

MIT
