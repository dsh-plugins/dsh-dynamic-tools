# Dynamic tools

冻结会话首步的工具声明头部，把之后才出现的工具以对话尾部消息下发。这样中途的工具变化不再改写请求前缀，模型提供方的缓存可以继续复用。

## 解决什么问题

DSH 的 `agent-loop` 在工具集发生变化、且当前路由没有声明 `toolUpdate` 能力时，会开启新的请求序列并重发完整系统提示词与工具声明。`openai-responses` 系列路由的 `supportsAdditionalTools` 在 `dsh-llm-pi-ai` 中被固定为 `withhold`，无法在 profile 里打开，所以在这类路由上：

- 进入计划模式时原生 `exit_plan_mode` 被准入 → 工具表变化 → 整个前缀失效；
- MCP 服务器晚连接、插件热插拔、条件工具转为可用，都会造成同样的失效。

本插件把声明头部固定下来：首步的声明集合被冻结，之后出现或被准入的工具通过尾部消息交给模型，模型仍可直接按名调用。

## 机制

1. **冻结头部**：每个 Agent 在首步组装时捕获其准入定义，剔除配置为动态的名字，深冻结后每一步原样返回。头部之后不再变化。
2. **尾部披露**：`agent/pre-step` 在其它监听器之后运行，把"已注册但不在头部"的工具以一条用户消息披露；消息里既有名字清单，也有完整定义（`disclosure.mode: schema`），并带上"可直接按名调用"的说明。定义变化按签名检测后重披露，工具消失时追加 `<tools_removed>`。
3. **声明≠准入**：头部里的工具若本步未被准入（`when` 判定为假），调用会在策略与审批之前返回一条可执行错误，绝不执行。工具被撤下时 `UNKNOWN_TOOL`。
4. **可见即记录**：披露消息带 `source.kind = dynamic-tools`，resume、fork、compaction 后由历史折叠重建；被压缩遮蔽的内容会在下一次开始时重发。
5. **按需加载**：`disclosure.mode: names` 时只报名字，模型调用 `tool_load` 取完整定义；`disclosure.requireLoad` 可要求动态工具必须先加载才能执行。

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
      name: dsh-dynamic-tools
```

## 配置

```yaml
- id: dynamic-tools
  name: dsh-dynamic-tools
  config:
    dynamic:
      names: ['exit_plan_mode']
      prefixes: ['mcp__']
    disclosure:
      mode: schema
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `installExistingAgents` | `true` | 加载时对已存在的 Agent 补装 |
| `skipPresets` | `['ptc']` | 这些预设自带执行器，本插件不接管（PTC 只能看到 `run_code`） |
| `dynamic.names` | `['exit_plan_mode']` | 永不进入头部的精确工具名 |
| `dynamic.prefixes` | `[]` | 同上，按前缀匹配（如 `mcp__`） |
| `dynamic.inlineNames` | `[]` | 强制进入头部，覆盖上面两条 |
| `disclosure.mode` | `schema` | `schema` 附完整定义；`names` 只报名字，需用 `tool_load` |
| `disclosure.requireLoad` | `false` | 动态工具必须先 `tool_load` 才能执行 |
| `disclosure.maxToolsPerMessage` | `8` | 单条披露消息的工具数 |
| `disclosure.maxSchemaBytes` | `6000` | 单个定义上限，超出转为名字公告 |
| `disclosure.maxMessageBytes` | `20000` | 单条消息上限，超出拆条 |
| `disclosure.announceRemovals` | `true` | 工具消失时追加 `<tools_removed>` |
| `unavailableReasons` | `{ exit_plan_mode: … }` | 头部工具未准入时的模型可见原因 |
| `maxParallelCalls` | `10` | 循环未给出并发上限时使用 |

分类只看名字，因为注册时的 `when` 条件对插件不可见；未列入 `dynamic` 的工具默认进入头部。工具一旦进入头部就保持声明，即使当前不可调用——这正是缓存稳定的代价与保证。

## 模型体验

### 模型看到什么

头部声明保持不变。动态工具在首次可用时以一条 `<system-reminder>` 出现：名字 + 描述 + 完整 JSON 定义 + "可直接按名调用"的说明；移除时出现 `<tools_removed>`。`names` 模式下模型需先调 `tool_load`，定义在其结果之后作为用户消息到达。

### Token 影响

头部每步大小固定；披露只在工具真正增减时追加一次。相比每步重发全部声明，动态工具越多、会话越长，节省越明显。定义上限保护单条消息不被超大 schema 撑大。

### KV Cache 影响

前缀在会话内保持字节稳定：工具声明、系统提示词都不再随工具状态变化。这是本插件的全部目的——实测进入计划模式后，切换点的缓存命中读数保持在同一量级而不是归零。代价是模型必须先读到披露消息才能调用新工具，且披露本身会新增若干 token。

## 已知限制

- **首次捕获时机**：头部在 Agent 首步组装时捕获。若插件在会话中途安装，或 resume 后注册集合与历史头部不同，会出现一次头部变化，此后稳定。
- **PTC 预设不接管**：PTC 只能用 `run_code`，其 SDK 文本随工具集变化；冻结 `tools:sdk` 不在本版范围。命中 `skipPresets` 时插件对该 Agent 完全让位并记录一次 info 日志。
- **分类靠配置**：`when` 条件不可见，无法自动识别"条件工具"；动态名单需要按名称或前缀配置。
- **重放外观**：披露消息在 Chat 里显示为普通用户上下文；重放时工具卡片使用通用样式。
- **拒绝文案**：默认只预置 `exit_plan_mode` 的原因，其它头部工具的拒绝信息是通用文案，可通过 `unavailableReasons` 覆盖。
- **无 UI 控制**：没有开关面板，所有行为通过 profile 配置。
