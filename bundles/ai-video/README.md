# ai-video 行业包 · 给 AI Agent 的安装与执行说明（runbook）

> 读者：被派来做视频的 AI Coding Agent（或交付同学）。
> 目的：**别跳步**。真机事故（2026-09-30 出镜人物 片）的根因就是"直接跑出片命令、
> 没先判视频类型、也没让分镜卡过字段规范闸"。

> **要把本仓能力接进桌面客户端（Codex / DeepSeek Harness）**：见 [`docs/AGENT-CLIENTS.md`](../../docs/AGENT-CLIENTS.md)
> —— 里面有 5 分钟接入（`list`/`invoke`/MCP 冒烟）、MCP 配置片段、**视频能力清单**（只读/预览 6 条）
> 与安全边界。本文（runbook）负责"怎么出片"，那份文档负责"怎么被 Agent 调起来"。

---

## 0. 正式入口：提交需求，由系统完成营销或叙事策划

客户只提供意图、档案 ID 和发布平台。系统自动分流，营销片走商品情报/G1 → 创意 → 洞察 → PRD → 剧本 → 定妆 → 分镜 → 完整提示词；叙事片走原生叙事策划。调用方不能替系统填写创意、剧本、分镜或提示词。

先启动本仓服务，取得当前工作区的成员令牌，通过环境变量设置 `WORKLOOM_ACCESS_TOKEN` 与 `WORKLOOM_BASE_URL`。令牌不得写入参数、日志或仓库。随后执行：

```bash
# 预生产：真实运行原生管线，输出项目 ID、运行回执及服务计划；此命令不提交影片渲染。
pnpm exec tsx scripts/tools/full-chain-film.mts --prepare \
  --intent "<客户需求原文>" --character <角色档案ID> --product <商品档案ID> \
  --platform 视频号 --pipeline marketing

# 复查本次系统片单、来源版本、完整步骤及预算预占上界。
pnpm exec tsx scripts/tools/full-chain-film.mts --project <项目ID> --plan

# 一次正式渲染与完整后期；预算不足会在提交之前拒绝。
pnpm exec tsx scripts/tools/full-chain-film.mts --project <项目ID> \
  --max-budget-cny <计划上界> --review-policy off --subtitle-mode both

# 中断后只查询原任务，不重新提交。
pnpm exec tsx scripts/tools/full-chain-film.mts --status <作业ID>
```

无指定角色或商品时可省略对应参数；`--pipeline auto` 由系统分流，叙事片可指定 `narrative`。分流不明确或营销片缺商品锚点时系统停止并留回执。`route-video.mts` 仍可作只读诊断，不能代替正式服务端策划资格。

正式入口拒绝 `--shots`、`--brief`、调用方 `document`、任意路径、裁剪步骤及 `post-only`。服务只冻结当前工作区本次成功预生产产物，绑定来源执行、完整提示词和片单 SHA-256；旧版本、篡改、缺证据均不能付费渲染。同一来源已有作业时返回 `FILM_SOURCE_ALREADY_SUBMITTED`，后续读取原作业状态。

## 1. 安装与环境（一次）

```bash
node -v            # >= 24
pnpm install
pnpm exec tsx scripts/tools/video-doctor.mts   # 出片环境自检（缺什么一目了然）
```

`video-doctor` 会检查：Node/pnpm、ffmpeg/ffprobe（含 `~/.workloom-color/bin` 与 `WL_FFMPEG`）、
火山方舟与评审模型密钥、配音工位、**配乐曲库与路径监狱**、真人/商品/片型/封面知识库、入口与 runbook 是否齐备。
`--json` 输出给 Agent 解析；存在 FAIL 时退出码 1。

工位与密钥（**不要写进仓库/日志/提交**）：

| 依赖 | 位置 / 变量 | 说明 |
|---|---|---|
| 视频/图片生成（火山方舟） | `~/.workloom/live.env`：`VOLCENGINE_ARK_API_KEY`、`SEEDANCE_MODEL`、`SEEDREAM_MODEL` | 出片/出图必需；**欠费时提交会被 403 `AccountOverdueError` 拒绝**（先充值再跑，别反复提交） |
| 系统策划/事前检查模型 | 服务端 `LLM_*` 配置；后期咨询模型为 `DEEPSEEK_API_KEY` | 正式策划及完整请求检查必需；渲染后审美默认关闭 |
| 调色/字幕/配乐工位 | `bundles/ai-video/connectors/{color,subtitle,bgm}-bridge` | 纯本地；ffmpeg 走 `~/.workloom-color/bin`（管线的 `WL_FFMPEG/WL_FFPROBE`） |
| 配音/人声核查 | `~/.workloom/voice-station`（本地 MLX 引擎，**不联网不花钱**） | `voice-bridge health` 可自检；音色档默认 `zh-xiaozhi` |
| 真人素材 | 火山方舟"私域真人人像库"的 `asset://...` | 参考图只能以 `asset://` 提交（平台禁止直传真人照片） |

自检：`bash scripts/agent-tour.sh`（能力巡游）、`pnpm exec tsx scripts/tools/route-video.mts --title test`。

## 2. 两条原生制作管线与完整后期

| 类型 | 正式入口 | 行为 |
|---|---|---|
| 营销片 | `full-chain-film.mts --prepare --pipeline marketing` | 从受控商品档案或真实来源建立事实包，经 G1 后完成原生营销策划；服务生成片单 |
| 叙事片 | 同上，`--pipeline narrative` | 由原生叙事引擎生成剧本、分镜及完整提示词；服务生成片单 |
| 口播解说片 | `pnpm explainer:run -- --script <稿> --profile <音色>` | 独立图文解说工具 |
| 手绘白板 | `whiteboard-film.mts --script <稿>` | 独立本地白板工具 |

正式影片的工位顺序固定，不能由调用方裁剪：

```
cine-kb → continuity → micromotion → spec → plates → material-gen → videos → voice
        → compose → color → subtitle → danmaku → bgm → cover → mux → master → deliver
```

逐镜步骤可因本次冻结来源而不适用，例如认证真人跳过图端点、无对白镜头无需补配音；服务按原生每镜判断并核验记录，不能由工位声称“不适用”而漏步骤。原生预生产同时生成开场钩子、场景圣经与道具/环境上下文，保留原始提示词、结构字段、顺序和时长。

## 3. 执行口径：中间系统检查，最终由客户验收

1. G1–G7 由系统检查完整本次产物并归档证据；中间不等待人工验收。已有定妆档案经当前文件摘要和身份来源核对后由原生定妆工位复用，无需重新出图。独立档案的客户验收登记工具仍见 §6。
2. 渲染前检查当前来源、授权、真人参考素材、商品绑定、参数/时长、完整最终请求与预算。系统模型检查失败时停止并记录原因，不用手写卡或放宽闸门继续。
3. `--max-attempts` 固定为 1。未知提交结果不自动重发；同一原生来源不创建第二个付费作业。明确返修需独立的历史回执流程，不能用 `post-only` 冒充正式首次制作。
4. 渲染后 `--review-policy off` 为默认：不作审美合格判定、不因审美重复渲染；成功媒体直接进入完整后期与交付。产物、时长、分辨率、音轨、音画对齐、字幕、命名及变体证据仍要核验。

## 4. 执行与留证纪律

- 外部 Agent 通过 `FilmServiceClient` 调正式 Studio/Film 服务；工位只经父服务受限通道调用模型、图片、视频、媒体与配音。公开 CLI 不接收模型密钥文件或任意片单。
- 每次付费提交前先写组件台账并预占费用。失败、未知结果和实际费用不可知均如实保留，不标为成功或零费用。
- 认证真人只用当前主档权威 `asset://` 参考；商品只用当前受控档案图片。封面和混音由正式后期工位生成，不手工替代。
- 本机无独立音轨签发者时，原生配乐工位可使用声明式直混；交付回执标注 `sourceAuthority=declared-unverified`、`stemsVerified=false`，不得冒充签章分轨。
- 账户欠费或原生策划失败时读取回执并停止付费提交。`--dry-run` 仅本地诊断，无生产资格，不能产出成功生产回执。

## 5. 交付物与验收

服务为每个作业选择受控输出目录。状态回执给出结果引用和摘要；正式交付包含实测时长命名的母版、软字幕版、`subtitles/`、三个风格变体及对应封面、主封面、交付清单和渲染台账。核对文件 SHA-256、变体差异、后期步骤记录、来源版本及每镜平台任务 ID，然后交客户作最终成片验收。

只读 `growth.video.production.status` 与 `growth.video.delivery.inspect` 可检查阶段和交付文件；`growth.video.production.plan` 只给正式服务命令，必须再运行 `--project --plan` 读取本次真实资格与预算。质量口径见 `docs/video-delivery-and-revision.md`。

## 6. 认证真人（asset://）：定妆照/角度槽位怎么落实

### 6.0 先跟客户要一样东西：**平台侧资产清单**（通用动作，别靠人肉登记）

> 真机（2026-09-30）：主档里 10 个同组素材 ID 有 8 个在控制台**查无此素材**，而管线取
> "主素材 + 前两张"作参考图 → 多参考图**静默失效**，表现只是"像不像不稳定"，日志里查不出错。
> **任何客户、任何一次建档都按下面这条走。**

请客户提供（任选其一，能复制文本最好）：① 控制台「资产详情」列表的 **源文件名 + asset ID** 两列
（截图也可以——Agent 会把两列转成文本）；② 或直接粘贴/导出 `asset-…` 列表；③ 素材组 ID（`group-…`）；
④ 明确**哪一张是主素材**（主档 `assetId`）与**授权范围/有效期**。

```bash
pnpm video:assets list --asset <assetId>                          # 现状（含管线实取的前 3 张）
pnpm video:assets reconcile --asset <assetId> --from <清单.txt>    # dry-run：新增/删除/不变
pnpm video:assets reconcile --asset <assetId> --from <清单.txt> --primary <主素材ID> --apply
```

纪律（工具已强制）：顺序=优先级（管线取"主素材 + 前两张"，前两张必须最像本人）；
**新 ID 一律标"待客户确认"，不猜角度**；写前备份 `profile.json.bak`，写后落
`asset-list-evidence.json`（清单 sha256 + 逐条来源文件名）并自动自检（主档可装载 + 属性校验 + 打印实取参考图）。

> 抽象口径：截图/清单只是"客户输入"；对账逻辑在 `packages/video-studio/src/real-person-asset-sync.ts`
> （纯函数、无客户常量），CLI 在 `scripts/tools/real-person-assets.mts`。**不要为某个客户写死 ID。**

真人素材在本地只有主档 ID，**没有图片文件**；角色档案的角度槽位必须由"客户导出的原图"或
"以授权素材为参考的派生图"逐张落实，否则"像不像门/首镜身份锚"没有真实基准：

```bash
# 客户从平台导出原图后（保留原文件名即可）：
pnpm exec tsx scripts/tools/portrait-set-install.mts \
  --character <角色ID> --library <角色库目录> \
  --from "<导出目录>" --mapping <角度映射.json> \
  --source customer-export --activate --out report.json
```

工具会校验（缺必需角度/同图占多角度/越界/非图片一律拒绝）、不覆盖历史版本、
写 `portraits/v<N>/source-map.json` 来源证据、更新档案并**写后复核**（未过即 exit 2）。
映射里必填 `front / threeQuarter / closeup / side`；可选 `frontFull / threeQuarterLeft /
threeQuarterRight / smileCloseup / back / actionPose / emotionCloseup / handDetail`。
派生（充值后 img2img）用 `scripts/tools/portrait-agent.mts`，产物必须标注"派生·非权威原图"。

### 6.1 客户只给一张「资产详情页截图」时的通用流程（无需客户逐张导出）

认证素材在**客户账号**里，平台没有"导出资产内容"的接口（`/assets/*` 实测 404）。通用做法是**两件输入**：

| 客户给什么 | 用途 |
|---|---|
| 控制台「资产详情」页**截图** | 结构：分组名/分组 ID/授权说明、逐行**缩略图**（判角度）、资源原始文件名、状态 |
| 从该页**复制的 ID 列表文本**（`asset-…` 每行一个） | **权威 ID**（截图小字不可靠：大模型会幻觉、本机 Vision OCR 也会把 `6r` 读成 `гq`；由 **Agent 读图后转成文本**再喂给 CLI，程序不直接吃截图） |

```bash
# ① 清单对账（客户截图/导出/粘贴文本 → 主档 referenceAssets/portraitSet 对平；默认 dry-run）
pnpm exec tsx scripts/tools/real-person-assets.mts reconcile \
  --asset asset-xxxxxxxx --from <清单文件.txt|json> --apply --label "客户控制台资产详情页截图"

# ② 两段式出定妆照（第一段视频路出身份母版；第二段图生图出其余角度；机器像不像只留证，不触发重做）
pnpm exec tsx scripts/tools/portrait-set-from-asset.mts \
  --asset asset://asset-xxxxxxxx --character <角色ID> --library <角色库> \
  --out-dir <角色目录>/portraits/_derived --angles front,threeQuarter,closeup,side \
  --engine two-stage --stage-a-angles front --refs 2 \
  --verify-against <已验收成片帧.jpg> --install --activate   # 机器像不像只留证；--require-likeness 才整批拒绝（旧行为）

# ③ 人类看过 8 张后记录验收（机器不代替签字；人类明确否决才阻断）
pnpm exec tsx scripts/tools/portrait-agent.mts accept --character <角色ID> \
  --by "<验收人>" --note "<依据/原话，例如：这 8 张可以的，都 ok 的>"
```

> 角度映射由 **Agent 读截图缩略图**给出（标 `angleGuess`，属"机器/Agent 判读、非客户逐张确认"）；
> 平台侧权威清单只提供 ID 与文件名，**不猜角度**——两者分工不要混。

### 6.2 职责边界：两套工具是**一条流水线的两层**（以哪个为准）

> 2026-10-01 收口：§6.0/§6.1 是同一件事的前后两段，**不存在两套竞争实现**，也不是"看谁先跑"。
> 以后遇到"到底用哪个"按下面这张表走；只有一处例外需要顺序约束（见末尾）。

| 问题 | 以谁为准 | 实现位置 |
|---|---|---|
| 客户截图/清单里**哪些 asset ID 有效**、顺序、来源文件名、组 ID、证据 | **清单对账层**（§6.0） | `real-person-assets.mts` + `packages/video-studio/src/real-person-asset-sync.ts` |
| 主档 `assetId` / `referenceAssets` / `referenceAssetSources` 的写回 | **清单对账层** | 同上（`reconcile --apply`，写前备份、写后自检） |
| 每个**角度槽位**怎么来、"像不像"谁判、产物写哪 | **出图/装机层**（§6.1） | `portrait-set-from-asset.mts`（两段式出图 + 机器像不像**只留证**）→ `portrait-set-install.mts`（写档 + `verifyPortraitSet` 复核）→ `portrait-agent accept`（**人类验收放行**，机器不决策） |
| 角色档案 `portraitSets`（`files`/`artifacts`/`active`/`source-map.json`） | **出图/装机层** | 同上；本层不对 `referenceAssets` 做任何推断 |
| 管线消费 | G-RP1/像不像门读**主档**（对账层）；封面/关键帧读**角色档案**（装机层） | `scripts/tools/full-chain-film.mts` |

**唯一顺序约束**：`reconcile` 会按清单重排 `referenceAssets`，并把**同 ID 保留的 `angleGuess` 之外的新 ID 标成"待客户确认"**。
因此正确顺序是：**先 §6.0 对账（ID 对了）→ 再 §6.1 出图装机（角度对了）**；对账后发现 ID 有变化，必须重跑角度映射那一遍，
不要拿旧的 `portraitSets` 当"已确认"。两层各写各的文件（主档 vs 角色档案），所以重跑任一层都不会覆盖另一层的产物。

四条硬经验（真机实测，别再踩）：
1. **图端点不吃 `asset://`**（400 `invalid url`）——asset 参考只能走**视频端点**取首帧；
2. **参考图 2 张最好**（角度对应那张 + 主素材）；4 张不同服装/光位混投会让脸跑偏；
3. **只对"人脸是真的"负责**（客户口径 2026-10-01）：发型/发色/妆造/服装/配饰/品牌标识/背景灰调差异**不得**判不合格
   （真人本来就会变），造型只作软性偏好；主素材若是古装/生活照，也**不要**因此把造型一致性当硬闸；
4. **机器像不像只留证、不决策**（T-2026-1001-0007）：阈值 88 的逐张实测保留为证据，但**不阻断、不触发重做**；
   8 张直接交人类验收（`portrait-agent accept`，`via=owner-acceptance`），人类明确否决才可以退回；只有显式 `--require-likeness` 才恢复"整批拒绝"旧口径；
5. **追加不重来**：后续补角度用 `--archive-refs <角色目录>`，以**已发布定妆照**为参考、旧版本保留——保证客户先后发布的视频人物一致。
