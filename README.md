# Dynamic tools

冻结会话首步的工具声明头部，把之后才出现的工具以对话尾部消息下发。这样中途的工具变化不再改写请求前缀，模型提供方的缓存可以继续复用。

对只调用 `tools` 数组内函数的模型（GPT 系列走 OpenAI Responses 协议），尾部文本读得到却调不了，因此另有一条「按需声明」通道：调用 `tool_load` 后再把该工具补进声明。见[GPT 系列路由](#gpt-系列路由按需声明)。

## 解决什么问题

DSH 的 `agent-loop` 在工具集发生变化、且当前路由没有声明 `toolUpdate` 能力时，会开启新的请求序列并重发完整系统提示词与工具声明。`openai-responses` 系列路由的 `supportsAdditionalTools` 在 `dsh-llm-pi-ai` 中被固定为 `withhold`，无法在 profile 里打开，所以在这类路由上：

- 进入计划模式时原生 `exit_plan_mode` 被准入 → 工具表变化 → 整个前缀失效；
- MCP 服务器晚连接、插件热插拔、条件工具转为可用，都会造成同样的失效。

本插件把声明头部固定下来：首步的声明集合被冻结，之后出现或被准入的工具通过尾部消息交给模型，模型仍可直接按名调用。只认声明列表的路由则走「按需声明」，多一次 `tool_load` 换取原生可调用。

## 机制

1. **冻结头部**：每个 Agent 在首步组装时捕获其准入定义，剔除配置为动态的名字，深冻结后每一步原样返回。头部之后不再变化。
2. **尾部披露**：`agent/pre-step` 在其它监听器之后运行，把"本步已准入但不在头部"的工具以一条用户消息披露；消息里既有名字清单，也有完整定义（`disclosure.mode: schema`），并带上"可直接按名调用"的说明。定义变化按签名检测后重披露，工具失去准入时追加 `<tools_removed>`。只注册、`when` 判为不可用的工具不会被公告——否则模型会去调用一个注定被拒的工具。
3. **声明≠准入**：头部里的工具若本步未被准入（`when` 判定为假），调用会在策略与审批之前返回一条可执行错误，绝不执行。工具被撤下时 `UNKNOWN_TOOL`。
4. **可见即记录**：披露消息带 `source.kind = dynamic-tools`，resume、fork、compaction 后由历史折叠重建；被压缩遮蔽的内容会在下一次开始时重发。
5. **按需加载**：`disclosure.mode: names` 时只报名字，模型调用 `tool_load` 取完整定义；`disclosure.requireLoad` 可要求动态工具必须先加载才能执行。
6. **按需声明**：命中 [`declareOnLoad`](#gpt-系列路由按需声明) 的路由把"已加载"的定义补进头部，让只认声明列表的模型也能调用动态工具。

披露消息形状：

```
<system-reminder>
<tools_added>
- exit_plan_mode: Use only in plan mode. …
</tools_added>

<tool_definition name="exit_plan_mode">
{"name":"exit_plan_mode","description":"…","parameters":{…}}
</tool_definition>

These tools are callable directly by name even though they are not in your tool list; match the definitions above.
</system-reminder>
```

## GPT 系列路由：按需声明

OpenAI Responses 系路由只调用请求 `tools` 数组里声明过的函数。把定义写进对话文本时，这类模型只把它当作对话内容：没有声明就没有可调用的名字，它也不会为了看不见的定义去 `tool_load`。本插件在这类路由上切到 `declare`：

1. 动态工具被准入时只公告名字（`<tools_added>` 与 `<tools_load_required>`），不带完整定义。
2. 模型调用 `tool_load`（在头部，必定可调用）拿到定义。
3. 该工具从下一步起进入请求的 `tools` 声明，模型直接按名调用；参数校验用的正是它读到的定义。

`tool_load` 只服务本会话公告过的名字：已注册但从未公告的工具（例如 `when` 判为不可用）返回 `Unavailable`，否则猜中的名字也会被永久塞进头部。`alreadyAvailable` 只表示"已在工具列表里"，不再重复下发。

这与 codex 的 `tool_search` → `tool_search_output` → 调用是同一形态。区别只在 codex 用 BM25 检索候选，本插件的公告已经给出确切名字，因此少一次检索回合，也不需要索引。

声明是单调的：已加载的工具此后一直留在头部，即使它失去准入或被注销。失去准入时调用返回 `unavailableReasons` 里的可执行拒绝，注销时得到 `UNKNOWN_TOOL`；头部不回撤，一次 `when` 抖动不会再把前缀打散。

代价是「每个加载过的工具一次前缀变化」：首个动态工具加载后请求头发生变化（`request/header` 的 `reason` 为 `change`），前缀从该点重建，此后只要不再加载新工具就保持稳定。动态工具用得越多，这笔一次性的账越接近默认策略的收益。

为什么不走原生 `tool_search`：`dsh-llm-pi-ai` 只在模型 compat 打开 `supportsToolSearch` 或 `supportsAdditionalTools` 时才把工具变化写成 `tool-addition`，而它对 `openai-responses`、`azure-openai-responses`、`openai-codex-responses` 三个协议把这两项固定标为 `withhold`，profile 打不开。所以这里由插件自己补一次声明。

## 安装

```powershell
npm install --ignore-scripts --legacy-peer-deps
npm run typecheck
npm run build
npm test
```

源码在 `src/`，运行时加载提交在仓库里的 `lib/`。所有 `@deepseek-ai/*` 都是 `peerDependencies`：以目录链接方式安装时，Harness 只把祖先 `package.json` 中声明为 peer 的名字解析到安装副本；`devDependencies` 只供 `tsc` 使用。`npm test` 用 Node 24+ 的原生类型剥离直接运行 `tests/*.test.ts`，只需在源码改动后重新构建。

通过 `plugin_manager` 的 `install_bundle` 安装本目录；`cordis.patch.yml` 插入一行 Host 入口：

```yaml
- insert:
    - id: dynamic-tools
      name: '@dsh-plugin/dsh-dynamic-tools'
```

以目录链接方式安装后，重新执行 `npm run build` **不会**让正在运行的实例换用新产物：模块 URL 不变，Node 的 ESM 缓存不会重新读盘，热重载也不重新导入它。改完源码并构建后需重启 dsh 实例，新会话才会加载新的 `lib/`。

## 配置

```yaml
- id: dynamic-tools
  name: '@dsh-plugin/dsh-dynamic-tools'
  config:
    dynamic:
      names: ['exit_plan_mode']
      prefixes: ['mcp__']
    disclosure:
      mode: schema
    declareOnLoad:
      models: ['gpt*', 'o1*', 'o3*', 'o4*', 'chatgpt*', 'codex*']
      providers: []
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `installExistingAgents` | `true` | 加载时对已存在的 Agent 补装 |
| `skipPresets` | `['ptc']` | 这些预设自带执行器，本插件不接管（PTC 只能看到 `run_code`） |
| `dynamic.names` | `['exit_plan_mode']` | 永不进入头部的精确工具名 |
| `dynamic.prefixes` | `[]` | 同上，按前缀匹配（如 `mcp__`） |
| `dynamic.inlineNames` | `[]` | 强制进入头部，覆盖上面两条；`tool_load` 恒在其中 |
| `disclosure.mode` | `schema` | `schema` 附完整定义；`names` 只报名字，需用 `tool_load` |
| `disclosure.requireLoad` | `false` | 动态工具必须先 `tool_load` 才能执行 |
| `disclosure.maxToolsPerMessage` | `8` | 单条披露消息的工具数 |
| `disclosure.maxSchemaBytes` | `6000` | 单个定义上限，超出转为名字公告 |
| `disclosure.maxMessageBytes` | `20000` | 单条消息上限，超出拆条 |
| `disclosure.announceRemovals` | `true` | 工具失去准入时追加 `<tools_removed>` |
| `declareOnLoad.models` | `['gpt*', 'o1*', 'o3*', 'o4*', 'chatgpt*', 'codex*']` | 命中这些模型名的路由改用按需声明 |
| `declareOnLoad.providers` | `[]` | 同上，按路由名限制；空表示不限路由 |
| `unavailableReasons` | `{ exit_plan_mode: … }` | 头部工具未准入时的模型可见原因 |
| `maxParallelCalls` | `10` | 循环未给出并发上限时使用 |

分类只看名字，因为注册时的 `when` 条件对插件不可见；未列入 `dynamic` 的工具默认进入头部。工具一旦进入头部就保持声明，即使当前不可调用——这正是缓存稳定的代价与保证。

`declareOnLoad` 的两个列表都支持 `*` 通配、大小写不敏感、整串匹配（`gpt*` 不匹配 `x-gpt-6`，`gpt-6.1*` 里的 `.` 是字面点）。两个列表为空表示强制所有路由走按需声明；策略按每一步的模型选择重算，中途切模型会随之切换。

## 模型体验

### 模型看到什么

`tail` 路由：头部声明保持不变。动态工具在本步首次被准入时以一条 `<system-reminder>` 出现：名字 + 描述 + 完整 JSON 定义 + "可直接按名调用"的说明；移除时出现 `<tools_removed>`。`names` 模式下模型需先调 `tool_load`，定义在其结果之后作为用户消息到达。

`declare` 路由：公告只给名字，说明改为"调用 `tool_load` 把名字加进工具列表，之后直接调用"；`tool_load` 的结果除了定义还会说明"从下一步起已声明"。

### Token 影响

头部每步大小固定；披露只在工具真正增减时追加一次。相比每步重发全部声明，动态工具越多、会话越长，节省越明显。定义上限保护单条消息不被超大 schema 撑大。

`declare` 路由上，每个被加载的工具会长期占据头部一份定义；只有确定要用的工具才值得加载一次。

### KV Cache 影响

`tail` 路由：前缀在会话内保持字节稳定，工具声明、系统提示词都不再随工具状态变化。这是本插件的全部目的——实测进入计划模式后，切换点的缓存命中读数保持在同一量级而不是归零。

`declare` 路由：稳定区间是「两次加载之间」。每次 `tool_load` 生效后的下一步会重发一次声明与系统提示词（`request/header` 的 `reason` 为 `change`），此后不再变化。代价是模型必须先加载再调用，且披露本身会新增若干 token。

## 已知限制

- **首次捕获时机**：头部在 Agent 首步组装时捕获。若插件在会话中途安装，或 resume 后注册集合与历史头部不同，会出现一次头部变化，此后稳定。
- **PTC 预设不接管**：PTC 只能用 `run_code`，其 SDK 文本随工具集变化；冻结 `tools:sdk` 不在本版范围。命中 `skipPresets` 时插件对该 Agent 完全让位并记录一次 info 日志。
- **分类靠配置**：`when` 条件不可见，无法自动识别"条件工具"；动态名单需要按名称或前缀配置。
- **路由匹配靠配置**：`declareOnLoad` 只认模型名与路由名；换供应商、改模型别名后需要同步，否则会退回 `tail` 策略而不是猜。
- **会话中切模型会有一次头部变化**：从 `tail` 切到 `declare` 时，此前的披露已经算作"已加载"，这些工具会直接进入头部；反向切换则退回初始的冻结集合。两端都是一次性变化，之后各自稳定。
- **声明单调**：`declare` 路由上加载过的工具不再回撤。工具注销后仍留在头部，调用得到 `UNKNOWN_TOOL`；这换来的是 `when` 抖动不打断缓存。
- **`declare` 下强制名字公告**：该策略要把"已加载"当作声明依据，附完整定义会被记成已加载，因此 `disclosure.mode` 在该路由上不生效，首次切换时记录一条 info 日志。
- **定义漂移**：已加载且仍准入的工具，声明用注册表里的实时定义（保证参数校验与执行一致），可能与模型当初读到的版本不同。
- **超大定义**：超过 `maxSchemaBytes` 的工具在 `tail` 路由仍按名字公告（模型可直呼其名），在 `declare` 路由则完全不公告——那里只能靠加载，公告一个注定加载失败的名字只会浪费回合；两种情况都会记录一次 warn。
- **重放外观**：披露消息在 Chat 里显示为普通用户上下文；重放时工具卡片使用通用样式。
- **拒绝文案**：默认只预置 `exit_plan_mode` 的原因，其它头部工具的拒绝信息是通用文案，可通过 `unavailableReasons` 覆盖。
- **无 UI 控制**：没有开关面板，所有行为通过 profile 配置。
