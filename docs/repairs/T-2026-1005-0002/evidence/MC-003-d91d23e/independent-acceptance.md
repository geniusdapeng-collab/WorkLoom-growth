# MC-003 独立验收：原生预生产超时透传

## 覆盖率声明

- 范围内文件总数：12；精读：12；机检/脚本解析：0；抽样：0；未读：0。此数字只计以下本轮审查源码、修复文档和执行上下文文件，不把运行日志计为源码阅读。
- 主要变更面 4 文件：[`llm-adapter.ts`](/Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30/work/growth-native-pipeline/packages/video-studio/src/llm-adapter.ts)、[`routed-adapter.test.ts`](/Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30/work/growth-native-pipeline/packages/video-studio/src/routed-adapter.test.ts)、[`native-video-entry.test.mts`](/Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30/work/growth-native-pipeline/scripts/native-video-entry.test.mts)、[`T-2026-1005-0002.md`](/Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30/work/growth-native-pipeline/docs/repairs/T-2026-1005-0002.md)。均全文阅读，变更 diff 逐段审查。
- 未变更调用实现 3 文件：[`router.ts`](/Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30/work/growth-native-pipeline/packages/base/model-router/router.ts)、[`providers.ts`](/Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30/work/growth-native-pipeline/packages/base/model-router/providers.ts)、[`index.ts`](/Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30/work/growth-native-pipeline/packages/base/model-router/index.ts)。均全文阅读，追踪适配器 → routeSmart → provider.chat → provider 取消/超时信号实现。
- 执行上下文 5 文件：[`AGENTS.md`](/Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30/work/growth-native-pipeline/AGENTS.md)、[`AGENTS.repo.md`](/Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30/work/growth-native-pipeline/AGENTS.repo.md)、[`WORKLOOM_PRODUCT_CONTEXT.md`](/Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30/work/growth-native-pipeline/WORKLOOM_PRODUCT_CONTEXT.md)、[`scripts/delivery/README.md`](/Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30/work/growth-native-pipeline/scripts/delivery/README.md)、[`packages/video-studio/package.json`](/Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30/work/growth-native-pipeline/packages/video-studio/package.json)。受控产品文档按分段全文读取；仓内与本地受控副本 SHA-256 同为 `59667533f52d296468d152eb7bc05908fef64decc8e6a5415b48938c79410e51`。
- 未读/抽样清单：无（在以上声明范围内）。明确范围裁剪：未重做 RDAS 276 项、未运行影片生产、未审查模型策略/价格/池/计量的全套未变更依赖、未精读 MCD 执行器源码。理由为本轮仅验收 MC-003，执行器采用仓内官方入口，执行和绑定关系另以 B 级证据核对；本报告不对范围外代码质量作结论。

## 验收结论与证据分级

**完全通过，仅限 MC-003 的超时透传契约。** 卡片已由官方运行器从 fixed 进入 verified，独立 acceptance 与随后 gate 均实际退出 0。[B]

- A＝代码精读；B＝实际执行/机器观测/元数据或散列校验；C＝抽样；D＝推断或未验证。测试运行信号按 B 标注，不能冒充源码精读或生产能力证明。
- [A] 宿主构造默认仍为 180000ms；路由分支新增 `timeoutMs: this.cfg.timeoutMs`，主力与 fast 共用该分支。出处：[`llm-adapter.ts:87`](/Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30/work/growth-native-pipeline/packages/video-studio/src/llm-adapter.ts:87)、[`llm-adapter.ts:117`](/Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30/work/growth-native-pipeline/packages/video-studio/src/llm-adapter.ts:117)。
- [A] `routeSmart` 优先采用正值 task.timeoutMs，否则走场景/60000ms 默认值，并向 provider.chat 下传 timeoutMs 和既有 signal。出处：[`router.ts:341`](/Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30/work/growth-native-pipeline/packages/base/model-router/router.ts:341)、[`router.ts:415`](/Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30/work/growth-native-pipeline/packages/base/model-router/router.ts:415)。既有 OpenAI 兼容 provider 把场景超时与外部取消信号合并，超时、取消与 HTTP 错误保持原有抛错路径：[`providers.ts:85`](/Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30/work/growth-native-pipeline/packages/base/model-router/providers.ts:85)。
- [A/B] 本次补充断言调用真实宿主适配器和基座 routeSmart，provider 端采用内存观测替身，逐项比较其 chat 的实际 opts。原生 Node 契约也独立写了同样六次观察，没有读取私有 cfg 后自说成功。两组执行实际通过。出处：[`routed-adapter.test.ts:45`](/Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30/work/growth-native-pipeline/packages/video-studio/src/routed-adapter.test.ts:45)、[`native-video-entry.test.mts:17`](/Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30/work/growth-native-pipeline/scripts/native-video-entry.test.mts:17)。
- [B] `git diff 4f5476b d91d23e -- packages/base/model-router` 输出为空。本次没有修改基座超时、取消、降级或计量实现。
- [D] 本轮没有触发真实供应商，没有测量供应商能否在 30/180/240 秒内返回，也没有证明完整影片产出。本断言验证每次 provider 调用的超时参数；它不是整个预生产流程墙钟上界。账本记录 environment.kind=client-runtime 也不把这组内存 provider 契约测试升级成 P 域生产实测。

## 完整提交与独立角色

- 审计基线：`4f5476b34c09429169e1f1d70aa848e0eb5d715b`。
- 修复基线/验收实际 HEAD：`d91d23e65001836712f7ebd2952794a68c792a35`，分支 `task/T-2026-1005-0002`。
- `git merge-base --is-ancestor audit repair` 及 `repair HEAD` 均实际退出 0；验收运行记录 working_tree_dirty=false；运行后 `git status --porcelain=v1` 为空。[B]
- 修复 actor：`root-video-mechanism-repair`；验收 actor：`native-entry-independent-acceptance`；独立会话来源：`/root/native_entry_acceptance`。本会话没有参与源码修复，没有提交或变更源码。actor 字段只是运行绑定，真实角色隔离由团队会话来源补足。
- 独立运行：`2026-10-05T09:01:23.478Z` → `2026-10-05T09:01:26.222Z`。实际 Node 二进制是 `/Users/mac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`，散列 `27db838bb204ef7c21df2931f5656e4c8fb32e6e947f363a402b49714d32b5b1`。[B]

## 实际运行与参数矩阵

运行器入口实际 argv：

```text
node scripts/delivery/mine-clear.mjs run-assertions --ledger outputs/mine-clear/T-2026-1005-0002/timeout-4f5476b/ledger.json --card MC-003 --actor native-entry-independent-acceptance --role acceptance --repo .
node scripts/delivery/mine-clear.mjs gate --ledger outputs/mine-clear/T-2026-1005-0002/timeout-4f5476b/ledger.json --repo .
```

调用这两条命令时单次给 PATH 前置上述 bundled Node 目录，未改 shell 配置。真正执行的断言 argv 含官方 Node reporter 与 TAP reporter，完整实际 argv 在原始 run JSON 中，不用人读 TAP 字符串推算测试数。

| 执行 | 工作目录 | 实际退出 | 结果 |
|---|---|---:|---|
| 官方 acceptance | /Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30/work/growth-native-pipeline | 0 | TestsStream 8 passed / 0 failed / 0 skipped / 0 cancelled / 0 todo |
| 官方 gate | /Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30/work/growth-native-pipeline | 0 | 1 张卡、12 条不变量放行 |
| 独立 routed-adapter Vitest | /Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30/work/growth-native-pipeline/packages/video-studio | 0 | 1 文件、8 项通过 |

参数结果由运行成功的 provider.chat opts 深比较断言支持，原始 opts 未另写 JSON；不把内存响应表述成远端真实模型响应。[B]

| 前置配置 | 步骤 | provider modelId | 预期 timeoutMs | 实际断言 |
|---|---|---|---:|---|
| 未配置 timeoutMs | reason 主力 | deepseek-v4-pro | 180000 | 逐项相等，通过 |
| 未配置 timeoutMs | reasonRaw fast | deepseek-v4-flash | 180000 | 逐项相等，通过 |
| timeoutMs=240000 | reason 主力 | deepseek-v4-pro | 240000 | 逐项相等，通过 |
| timeoutMs=240000 | reasonRaw fast | deepseek-v4-flash | 240000 | 逐项相等，通过 |
| timeoutMs=30000 | reason 主力 | deepseek-v4-pro | 30000 | 逐项相等，通过 |
| timeoutMs=30000 | reasonRaw fast | deepseek-v4-flash | 30000 | 逐项相等，通过 |

## 回归维度与范围边界

各用例均在无生产凭据的隔离进程中运行；HTTP/client 测试使用内存响应，工位交接只构造实际 FullChainFilmWorker，不调用付费媒体通道。[A/B]

| 维度 | 前置与步骤 | 预期 | 实际 |
|---|---|---|---|
| 正常/默认/边界配置 | 上述三种 timeout 配置，分别主力与 fast | 六次 provider 接收精确参数 | Node 与 Vitest 均通过 |
| 错误/调用方权限边界 | 传入调用方 shots/document；client、server、CLI 三面拒绝 | 无 client 请求；server 在 DB/provider 前拒绝；CLI 退出 2 | Node 对应 3 项通过 |
| 阶段/绕过边界 | 逐一省略 native stage、传部分制作/重试选项 | PIPELINE_INCOMPLETE 或 BYPASS_FORBIDDEN/RETRY_FORBIDDEN | Node 对应项通过 |
| 元数据污染 | 顶层与 brief 嵌套传 shots、storyboard 等生成物 | CALLER_SOURCE_FORBIDDEN；合法 archive 身份通过 | Node 对应项通过 |
| 原生请求回归 | 只传 intent、角色/产品归档身份与 route | 请求体无调用方分镜，非法 shots 拒绝 | Node 对应项通过 |
| 工位交接回归 | 构造完整作业，父服务投影去内部 nativeSourceKey | 来源身份留在父账本；输入冻结相同；零网络调用 | Node 对应项通过 |
| 降级/全部不可用/JSON 错误 | MockProvider unhealthy；全链 down；非 JSON response | 降级留痕；success:false + retryable；JSON 提取失败可见 | Vitest 对应 3 项通过 |

未执行项：长时间等待超时、并发取消压力、真实 HTTP provider 延迟、真实影片生产、全仓类型检查与 RDAS 276 项。这些不属于本轮 MC-003 的透传验收；既有超时/取消实现精读只解释行为，不替代这些动态验证。视频包 tsc 的修复会话通过仅来自交接，本轮未独立重跑，按 D 级记录。

## 原始证据绑定

以下相对路径均相对本报告目录；散列已实际回读核对。[B]

| 证据 | SHA-256 |
|---|---|
| runs/MC-003-0-1791190883478.json | 11234feb6c20b522aa7e5c1735d93fee28eac651616849389ad63e602617eec5 |
| evidence/MC-003-0-1791190883478.txt | 1c78d89b162c2071c4f1a7b0f2282a62b9f3494782bc1799c7694f1e02dbf725 |
| evidence/MC-003-0-1791190883478-node-tests.jsonl | b2d0dacc5af8e5659a643bb716700a65c58ffcc6bf8f60a692d6a769843bb358 |
| ledger.json（本轮验收后快照） | af055b61edc2df995b8583cd98a8feaa9d4f0ad015a074f799493278652288a6 |

附加原文：independent-acceptance-command.log、independent-gate.log、independent-routed-adapter.log。JSON receipt 保存实际工具退出与成功/失败尝试，正式角色/argv/Node 观测仍以官方 run 原文为准。

运行插曲也保留：
- 首次裸 node 命令因 shell PATH 没有 Node，实际退出 127；未启动运行器。改为单次 PATH 前置 bundled Node 后成功，日志 independent-shell-path-attempt.log。
- 首次从仓库根运行 Vitest，路径子串过滤同时命中正在构建的 ignored dist-payload 副本。源码测试 8 项通过，但副本缺 providers.js 造成总退出 1。按 [Vitest 官方 CLI 的路径包含过滤说明](https://vitest.dev/guide/cli.html)，改在视频包 cwd 运行同一源码文件后退出 0。日志 independent-routed-root-attempt.log 与成功日志均保留。该尝试没有改源码或测试配置，也不作为 MC-003 失败。[B]

## 同一 HEAD 的三卡最新验收

协调者追加了 MC-001、MC-002 的同提交独立基线刷新。本轮逐一卡实际运行官方 acceptance 后再 gate，两卡均退出 0；各机器摘要为 8/8。MC-003 原始验收继续保留，未改写历史运行。以下是三次执行同一 8 项文件，不统计成 24 个唯一用例。[B]

| 卡片 | 最新 acceptance run | run SHA-256 | acceptance/gate |
|---|---|---|---|
| MC-001 | MC-001-0-1791191416774 | 388af4bcedfda4bf5ae1d5e2ca76b99b35475646796370006c7db89d791a2fa5 | 0 / 0 |
| MC-002 | MC-002-0-1791191419376 | 57de9e7a403b8463bd0547604693f7de501b9496fbaccab9802137971ae28c19 | 0 / 0 |
| MC-003 | MC-003-0-1791190883478 | 11234feb6c20b522aa7e5c1735d93fee28eac651616849389ad63e602617eec5 | 0 / 0 |

三卡均绑定完整 HEAD d91d23e65001836712f7ebd2952794a68c792a35、角色 native-entry-independent-acceptance、working_tree_dirty=false。逐卡台账均为 verified，fixed_by 与 verified_by 不同，验收基线为修复后代；官方 gate 每卡检查 12 不变量。原生来源拒绝、完整工位交接与超时透传的本轮机器证据均已重绑该提交。[B]

MC-001/MC-002 的最新完整账本目录已逐字复制到本目录 refreshed-cards/MC-001 与 refreshed-cards/MC-002；MC-003 的官方证据保留在本目录。三张独立回执为 MC-001-receipt.json、MC-002-receipt.json、MC-003-receipt.json，汇总回执 independent-acceptance-receipt.json 指向这些同目录证据。复制后最新 run 的 SHA-256 与原目录一致。[B]

没有重复 PG、重审旧实现、启动模型或制作影片。旧 87f6bcd 的 PG 实测证据由协调者保留；本轮没有把那条旧提交证据冒充 d91d23e 的新 PG 实测。MC-001 台账环境为 local-preview；其余两卡为 client-runtime；这三组无远端调用的 Node 契约都只证明源码结构与本地调用边界。[D]

## 收尾报告

- 已完成：三卡同一 d91d23e 的官方独立 acceptance、逐卡 gate、最新回执归档；4 个 changed files 全文与 diff 审查；基座路由/超时/provider 取消实现追踪；六组实际 provider 参数断言；官方独立 acceptance；随后 gate；独立路由 8 项；角色、完整提交、后代关系、干净源码状态与证据散列回读；报告、原始日志和 JSON receipt。
- 未完成/未覆盖：范围外的真实供应商、影片与 RDAS 276 项未执行；具体动态边界见上表后说明。没有将这些标为通过，没有阻断在范围内未完成的事项。
- 自主追加事项及理由：为避免构建副本污染测试文件发现，将 routed-adapter 的执行 cwd 限定到视频包；保存两次运行环境插曲，保证退出码透明。
- 采用的假设：本轮来源 HEAD 应保持 d91d23e 完整提交；运行前后已实际核对。provider 内存替身足以验证入参传递，无法验证远端模型能力。
- 置信度：高，限于 MC-003 参数透传；完整影片与供应商能力未验证。
- 建议复核：官方 run 的 actor/完整 argv/TestsStream；六组 timeout/provider 精比较断言；adapter:117 与 router:415 的单一路径。

## 自检表

- [是] 覆盖了本轮 MC-003 全部授权范围，而非挑了容易的部分；范围外项已逐项声明。
- [是] 没有把可自主完成的事项推给用户，没有以不必要的问句收尾。
- [是] 每个结论有代码或运行依据；A/B/D 标注区分源码、观测和生产未验证。
- [是] 可按完整 HEAD、实际 argv、退出码、机器摘要和 SHA-256 复核，源码保持只读。

