# Dynamic tools

此插件保持顶层工具名单稳定，并为显式配置的 Responses 路由在历史原位置追加 `additional_tools`。新增动态工具不改变顶层声明；已有顶层工具的定义发生变化时，原生路由直接更新对应声明。

## 路由与协议

| 策略 | 动态定义的位置 | 加载后顶层 `tools` | 适用路由 |
| --- | --- | --- | --- |
| `responses` | `input` 中的原生 `additional_tools` | 保持初始基线 | 显式配置且支持该协议的 Responses HTTP/SSE 端点 |
| `declare` | `tool_load` 后进入顶层声明 | 会变化，可能使旧缓存失效 | 命中 `declareOnLoad` 的其它路由 |
| `tail` | 插件持久化的普通上下文消息 | 保持初始基线 | 能按文本定义调用工具的其它模型 |

优先级为 `responses` → `declare` → `tail`。`responses.routes` 默认为空，不能仅凭模型名推断端点支持原生追加。每条规则的 `provider` 精确匹配；`models` 支持现有的大小写不敏感 `*` 通配、整串匹配，空数组表示该 provider 的全部模型。provider、baseURL 和模型别名均可自定义，插件不限定 OpenAI 官方域名。

`additional_tools` 与 `tool_search_output` 是两种不同协议。前者直接在指定历史位置引入工具；后者对应一次原生 `tool_search` 调用的检索结果，必须保留其调用关联。本插件已有精确工具名称与分类，使用前者，不伪造检索调用，也不把普通消息中的 JSON 当作原生声明。[OpenAI 工具加载文档](https://developers.openai.com/api/docs/guides/tools-tool-search#add-tools-at-a-specific-point-in-the-input)、[Codex 实现](https://github.com/openai/codex/blob/aea4c6ee4b652d84b416731b11c2b8299d767209/codex-rs/core/src/context/world_state/top_level_tools.rs#L215-L309)。

DSH 模型配置中的 `withhold` 限制 profile 手工填写对应能力字段；内置模型目录已有的能力值仍可继承。自定义 provider 和别名未必继承这些值，因此不能把 `withhold` 解释为所有 GPT 路由都禁用了原生动态工具。

## 安装与开发

需要 `dsh-loader ^2.0.0-dev.45136353623`、DSH `>=0.2.2-rc.2 <0.3.0` 和 Node.js `>=24.9.0`。插件通过 loader 的 `llm.registerResponsesToolAdditions` 注册原生追加，并要求 loader 支持保留顶层同名定义。

```powershell
dsh plugin --profile web add @dsh-plugin/dsh-loader@next @dsh-plugin/dsh-dynamic-tools@next
```

原生 Responses 支持通过 `next` 渠道提供。验证本地代码时，在两个仓库构建后安装本地目录：

```powershell
# 在 dsh-loader 目录
npm run build
# 在 dsh-dynamic-tools 目录
npm install --ignore-scripts
npm run typecheck
npm run build
npm test
# 替换为实际绝对路径和 profile
dsh plugin --profile web add C:/Projects/self/dsh-plugins/dsh-loader C:/Projects/self/dsh-plugins/dsh-dynamic-tools
```

运行时代码通过 loader 获取宿主的工具定义、schema 投影、消息构造与执行管线。`@deepseek-ai/*` 的源码导入仅用于类型。动态工具仓库跟踪 `lib/`，修改源码后需要构建并重启测试实例；同一模块 URL 的热重载不会清除 Node.js ESM 缓存。

## 配置

```yaml
- id: dynamic-tools
  config:
    dynamic:
      names: ['exit_plan_mode']
      prefixes: ['mcp__']
    disclosure:
      mode: schema
      requireLoad: false
    responses:
      routes:
        - provider: mclans-gpt
          models: ['gpt-*', 'my-gpt-alias']
    declareOnLoad:
      models: ['gpt*', 'o1*', 'o3*', 'o4*', 'chatgpt*', 'codex*']
      providers: []
```

新增的 Responses 路由也可以在 loader 的“动态工具”配置卡片中保存，持久化路径为 `<profile>/config/dsh-dynamic-tools/config.json`。已有持久化值优先于 profile 中的初始默认值；保存后从下一步开始重新判定路由。其余既有配置仍在 profile 设置。

模型设置中展开模型卡片，可勾选“启用原生工具路由”。勾选只修改当前 provider 的草稿；点击 provider 的“保存”并成功后才写入路由配置，取消或离开编辑器会丢弃草稿。折叠模型、调整顺序不会提前写入。新建 provider 需要先保存，再编辑其模型路由。provider 保存失败时可继续修改后重试；如果 provider 已保存而路由配置写入失败，页面会显示独立的重试提示。

模型卡片使用 `responses.overrides` 保存精确的 provider/model 选择，优先于 `responses.routes` 的通配规则。取消勾选只关闭该模型的原生策略，不改变同一通配规则下的其它模型。删除对应 override 可恢复继承通配规则；关闭原生策略后继续按 `declareOnLoad` 和 `tail` 的顺序判定。

| 字段 | 默认 | 行为 |
| --- | --- | --- |
| `installExistingAgents` | `true` | 对已存在的 Agent 安装执行器 |
| `skipPresets` | `['ptc']` | 保留这些预设自己的执行器 |
| `dynamic.names` | `['exit_plan_mode']` | 首次捕获时从静态头部排除的精确名称 |
| `dynamic.prefixes` | `[]` | 按前缀排除，如 `mcp__` |
| `dynamic.inlineNames` | `[]` | 强制进入初始头部；`tool_load` 始终列入 |
| `disclosure.mode` | `schema` | 自动披露定义；`names` 只公告名称，等待 `tool_load` |
| `disclosure.requireLoad` | `false` | 为 true 时只公告名称，加载成功并保存后才允许动态调用 |
| `disclosure.maxToolsPerMessage` | `8` | 每条声明或通知的工具数上限 |
| `disclosure.maxSchemaBytes` | `6000` | 单个 schema 的 UTF-8 字节上限 |
| `disclosure.maxMessageBytes` | `20000` | 原生声明和通知按最终 UTF-8 文本大小分批；连单条通知也放不下时明确报错 |
| `disclosure.announceRemovals` | `true` | 既有策略的移除公告开关；原生策略始终记录不可用通知 |
| `responses.routes` | `[]` | 显式启用 `additional_tools` 的 provider/model 规则 |
| `responses.overrides` | `[]` | 模型卡片的精确选择，`enabled` 优先于通配规则 |
| `declareOnLoad.models` | GPT/o 系列规则 | 未命中原生规则时，匹配这些模型走按需顶层声明 |
| `declareOnLoad.providers` | `[]` | 既有策略的 provider 通配规则，空表示不限 |
| `unavailableReasons` | 含 `exit_plan_mode` | 未准入工具的模型可见拒绝原因 |
| `maxParallelCalls` | `10` | 宿主未给出并发上限时使用 |

## 声明、执行与历史

- `schema` 且未要求加载时，原生路由自动追加定义；`names` 或 `requireLoad: true` 时，`tool_load` 才生成追加记录。超过大小限制的原生定义只公告名称，加载返回 `tooLarge`，并记录诊断。
- 接管旧会话时若 `tool_load` 不在顶层且没有当前版本的追加定义，直接追加加载入口，避免要求入口先加载自己；入口也受大小限制，无法容纳时明确报错。顶层已有入口时，定义变化直接更新顶层。
- 每次原生声明都是插件来源的用户消息，保存版本、稳定标识、完整 schema 和对应正文。loader 发送时在该消息原位置替换为 `{type: "additional_tools", role: "developer", tools: [...]}`，不再重复发送正文。
- 来源、标识、正文与序列化位置必须一一对应。缺失、重复、伪造或映射不完整会停止请求。用户文本中的 schema 不会注册为工具。
- 原生路由直接更新定义有变化的顶层工具，保持顺序和其他工具不变；该变化可能使旧缓存前缀失效。会话有效权限为 `danger-full-access` 时，首个请求就省略宿主工具的 `sandbox_permissions` 和 `justification`；切回受限权限时按宿主注册恢复参数。
- 顶层定义优先。历史追加批次中的顶层同名条目只在发送时过滤，其余动态工具保留原位置；动态工具的定义变化时仍追加新记录。工具失去准入时保留已声明定义并追加不可用通知；实际执行始终按本步准入、当前声明、宿主参数校验、权限和审批处理。
- 重复加载顶层工具或已保存且未变化的定义返回 `alreadyAvailable`。预披露与尚未提交的 `deferContext` 不计入已加载状态。
- 恢复或派生会话时，从已记录的请求头恢复顶层名单，并按有效历史顺序折叠动态声明。历史压缩删除的动态声明重新披露或加载。旧文本格式在既有策略中继续按原语义读取。
- 从其它策略进入原生策略时重新捕获已保存头部；连续原生步骤保持顶层名单。本步策略与 provider/model 在组装时固定，配置保存仅影响下一次组装。

## 传输与缓存边界

本实现仅转换 Responses HTTP/SSE，不为 WebSocket、Chat Completions 或只支持 `tool_search` 的端点启用该协议。显式原生路由被端点拒绝时报告错误，不自动回退到改变顶层工具列表的 `declare`。

loader 使用公开 `llm/stream` 事件建立 `AsyncLocalStorage` 请求作用域，并通过 `loader.patch.global('fetch', ...)` 与网络设置插件协作。转换支持取消、重试、并发会话隔离和卸载；辅助请求不参与转换。

验收目标是消除工具加载导致的前缀变化。缓存命中仍受模型、路由、有效期、其它提示词变化等因素影响，不能保证每次 `cached_tokens` 都大于零。[OpenAI 缓存规则](https://developers.openai.com/api/docs/guides/prompt-caching)。跨策略切换、宿主其它提示词更新或历史压缩也可能改变可复用前缀。

`declare` 保留既有顶层追加行为，会改变缓存前缀；`tail` 依赖模型按文本定义调用工具。PTC 等自带执行器的预设继续跳过，本插件不修改宿主。
