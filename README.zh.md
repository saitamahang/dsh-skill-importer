# dsh-skill-importer

[English](README.md) | 中文

[![npm version](https://img.shields.io/npm/v/dsh-skill-importer)](https://www.npmjs.com/package/dsh-skill-importer)
[![npm downloads](https://img.shields.io/npm/dm/dsh-skill-importer)](https://www.npmjs.com/package/dsh-skill-importer)
[![License: MIT](https://img.shields.io/npm/l/dsh-skill-importer)](LICENSE)

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（`dsh`）的技能管理插件：在 Web UI 里直接导入、查看、删除技能——不经过 agent、不需要会话、不消耗模型 token、无审批。文件立即落盘，harness 自动热发现。

## 功能

- **三个技能入口**（`/` 菜单不再直接列技能）：
  1. **输入框工具行技能选择器**（权限选择旁边）：pill 触发，弹出带名称筛选框的列表，首字母头像 + 纯名称
  2. **`/skills` 命令**——仿 `/model`：弹出技能列表，按名称搜索，选中自动填入 `/名称 `
  3. **直接输入 `/名称 `**——原生文本手势，同样高亮并注入技能正文
- **已安装列表按位置分组**：`.agents/skills`、`.dsh/skills`、`~/.dsh/skills` 每处副本都展示（管理面不做 rank 隐藏），含调用策略标记，每项可单独删除
- **工作区感知**：项目目标写入「当前已注册工作区」（绝不写 dsh 进程的启动目录），与 `/` 菜单、模型目录的解析一致，导入后立即可见
- **从文件导入**：选本地 Markdown（`SKILL.md` 或 `<名称>.md`），前端解析并校验 frontmatter（`name` 必须 kebab-case、`description` 必填），预览确认后写入 `<目标>/<名称>/SKILL.md`
- **从 URL 导入**：host 进程抓取（`.md` 原样写入；HTML 粗略提取正文）
- **frontmatter 规范化**：描述等字段含特殊字符时自动加引号，严格 YAML 发现永不静默跳过
- **中英双语 UI**：设置页与选择器跟随 harness 语言，样式对齐「通用设置」行

## 设计原理（为什么不需要"目标会话"）

dsh 的 client→host RPC 是硬编码白名单，没有写文件通道；但 **`dsh-host-webserver` 提供官方路由注册扩展点**（`ctx.webServer.register`）。插件在 harness 自己的同源服务器上注册 `/skill-importer/*` 路由：

```
浏览器读文件 / 输入 URL
        │ fetch（同源）
        ▼
host 路由 /skill-importer/import（注册在 ctx.webServer 上）
        │ 直接写文件（host 进程权限——无沙箱、无审批）
        ▼
<目标>/<名称>/SKILL.md 落地
        │
        ▼
skill-filesystem 的 watcher 发现 → skills/change → 热刷新
```

- **无会话**：host 进程直接写盘，与会话/agent/模型无关
- **无审批**：host 拥有用户权限，不经过 agent 工具的沙箱
- **安全**：路由只挂在 loopback 服务器上；`POST` 校验 `Origin`（仅放行 `127.0.0.1`/`localhost`）

## 环境要求

- DeepSeek Harness `>= 0.1.0-rc.6`（`npx @deepseek-ai/dsh web` 方式运行）

## 安装

### 从 npm

```sh
# 1. 把插件装进 web profile
dsh plugin --profile web add dsh-skill-importer

# 2. 在 $DSH_HOME/profiles/web/cordis.patch.yml 追加一行：
#    - id: skill-importer
#      name: 'dsh-skill-importer'

# 3. 重启 dsh web
```

### 从本地源码（开发）

```sh
npm install
npm run build
dsh plugin --profile web add /path/to/dsh-skill-importer
# 同样追加上面的 cordis.patch.yml 行，然后重启 dsh web
```

设置页左侧导航出现「技能」分区。

## 使用

1. **导入**：设置 → 技能 → 选本地 Markdown（或填 URL）→ 选目标目录 → 导入。成功后表单自动清空，列表自动刷新。
2. **使用**：任意会话中，从工具行技能选择器选、运行 `/skills`、或直接输入 `/名称 `——三种方式都会在输入框填入 `/名称 `（带高亮），发送即注入技能指令。

## 开发

```sh
npm install
npm run build     # tsc 产出 lib/types；tsdown 产出 lib/index.js + lib/client.js
```

结构：

- `src/index.ts` — host 插件体：注册 `/skill-importer/*` 路由（`inject: ['webServer', 'workspaceRegistry']`）
- `src/server.ts` — 纯 Node 逻辑（写盘/删除/列表/URL 抓取/HTTP 层），无 Cordis 依赖，可直接冒烟测试
- `src/types.ts` — host/client 共享线格式类型
- `src/client/index.ts` — 浏览器插件体：设置页、`/skills` popupSelect、隐形 lexicon 源
- `src/client/SkillsPicker.tsx` — 工具行技能选择器（筛选 + 首字母头像）
- `src/client/SkillImporterSection.tsx` — 设置页（通用设置行风格，中英双语）

路由一览：`GET /skill-importer/health` · `GET /skill-importer/list` · `POST /skill-importer/import` · `POST /skill-importer/import-url` · `POST /skill-importer/delete`

## 已知限制

- 单文件 ≤ 256 KB
- URL 导入对 HTML 页面只做粗略文本提取，推荐指向 `.md` 文件
- 目标目录固定为三个标准技能根（不支持任意路径，这是安全边界）
- 导入后列表会短暂轮询刷新（2 秒间隔，最多 20 秒）；外部改动点「刷新」立即同步

## License

MIT
