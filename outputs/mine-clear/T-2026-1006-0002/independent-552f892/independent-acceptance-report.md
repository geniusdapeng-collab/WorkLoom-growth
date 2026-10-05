## 覆盖率声明

- 范围内文件总数：66；精读：61（本卡完整读取39，自身旧精读字节相同继承22）；机检/脚本解析：3；抽样：2；未读：0。
- 逐项清单、旧阅读提交、完整SHA256和两个vendor裁剪区间见 [independent-source-coverage.json](independent-source-coverage.json)。大vendor编排器与兼容层仅继承明确相关区间的C级，未声称全文件精读；lock、schema和额外规范只作B级机检。
- 另对当前5663个受控文件逐项核对完整Git blob与磁盘字节，并在测试后再次核对完整SHA；这是B级身份检查，与上述语义阅读范围重叠，不能作为全仓理解度。

**本卡本机预览结构与离线协议验收：完全通过。** 当前源为 `552f892edd2d97f264c7bfc2d23c8c7db472ff91`，审计为 `c523e9e24300755a6f65c018712ad85c1005838d`，原修复绿为 `5bee55d6a754462ca60cdf2a98bd9b1e6807193d`。独立actor为 `native-entry-independent-acceptance`，修复者为 `/root/mc024_facts_scoring_repair`；标准MCD实际运行将MC-024从fixed进入verified，没有借用修复者运行或修改旧observer路径。环境档位是local-preview。

| 实际验证 | 当前结果 | 当前原始记录 |
|---|---|---|
| facts请求、完整原A3字节、诚实/虚假空值、否定/限制/数字冲突、85边界、非法结构/缺模型/归档失败及非facts环节 | 26/26通过，0跳过 | 两条正式断言之一及其TestsStream摘要 |
| 原事实评审、抽取、原生档案与来源限制；并发/脱离作用域/来源复读 | 30/30通过，0跳过 | 第二条正式断言及其TestsStream摘要 |
| 最近监制、逐叶子事实、来源与权限 | 90/90通过：producer40、authority33、facts17；0跳过 | narrow-producer-facts-authority-vitest.json |
| 自有industry-contract实际构建；video/server类型检查 | 三项均实际退出0 | operations完整argv、输出和前后源身份 |
| 标准gate→handoff→postgate | 三项均实际退出0；闭环1、未闭环0 | ledger.json、handoff.json及operations |

当前146个不同案例各执行一次，前置条件、步骤、预期、实际结果和当前源/运行摘要见 [independent-test-cases.json](independent-test-cases.json)。Node由受控reporter回读真实非零逐文件计数；Vitest三个文件在同一次运行实际执行，不将归档副本或被过滤的外层加载计为案例。

**A，源码规则：** `producer-gate.ts:522-530` 的强制facts文本区分主张支持关系与检索覆盖。诚实no_evidence仍要求模型复核完整原文、status/noEvidenceReason和限制，不预置分数或批准；虚假空值、无支持主张、否定/限定/型号/数字/单位冲突或限制弱化仍要求拒绝。默认/custom rubric都收到强制规则，其它阶段的规则保持。阈值、HTTP、归档、解析及批次的产品代码保持原行为；最小变动只在facts文本。

**B，实际执行与历史字节：** 正式当前26+30及近邻90均通过。原VID1015的完整A3review、request、response、extraction和judge-exchange字节保持，原true/76继续按85门槛拒绝；这些固定回包独立于提示词内容，不根据关键词补分。8个行为/测试/fixture文件与5bee完整字节相同；552f对5bee仅335项文档/封存变化。原修复档案124文件和MC023封存209文件逐原字节核对相同，复制保持旧源与原绝对observer路径。

**C，显式阅读裁剪：** vendor总编排器和vendor-compat只覆盖清单中的原生来源、PRD/G4/脚本装订相关区间；其它vendor制作、兼容、后期与宿主广域实现不形成此卡语义结论。本卡不复跑旧MC022/MC023宽套件；旧运行仅按原字节与原SHA保留。

**D，真实效果边界：** 新真实模型是否遵守评分域、会给何分尚未知。这些离线固定响应断言不能证明新语义裁决、人物真实同脸、美学、完整成片或签名发行。没有真实模型、供应商、客户媒体、PG、业务服务或远程写操作。既有测试临时loopbackHTTP只服务自有文本夹具，唯一媒体过程为当前已授权的lavfi测试视频本地ffmpeg/ffprobe及五时刻采样。

准备阶段初次广域依赖审计实际退出1，未启动正式验收；23个未使用旧store断链、0外部源链接保留在清单。恢复使用自有APFS克隆与104个已选传递依赖闭环，不宣称整个旧store完整。实际选用的loader、Vitest、compiler和编解码器路径/散列见execution-rebind.json；先前自身包wrapper原字节保留。当前正式断言和近邻回归各只有一次，均无失败。原修复者的缺动态文件、丢失首个0测试原run、89通过/1跳过后精准补跑等历史原文独立留存，没有制造丢失run或改为当前验收。

原始运行与文件身份在 [independent-validation.json](independent-validation.json) 回读；原操作根 `/Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30/work/growth-native-acceptance-9c69b8c/outputs/mine-clear/T-2026-1006-0002/independent-552f892` 仍保留。交付目录为原字节审阅副本，副本不算另一次执行，不能改写绝对observer destination来伪造副本门禁。

## 收尾报告

- 已完成：当前最终552f干净完整检出；必要完整读取及自身旧阅读字节继承；56正式独立断言、90近邻回归；本机自生成视频采样；行业合同构建和两类型检查；标准gate/handoff/postgate；146案例、三基线、角色分离、当前5663文件与历史档案核对；原字节封存。
- 未完成/未覆盖：本独立角色的授权范围均已完成。真实模型评分、原意图预生产、完整影片与生产发行属于协调会话后续实测，当前无结果；广域vendor实现按C级显式裁剪，旧store23无关断链保留B级清单。
- 自主追加事项及理由：选择自有已闭环loader/Vitest/TS真实路径，避免wrapper版本漂移；执行前排除outputs/dist-payload测试副本；复核原固定true/76拒绝和旧209文件不可变性；复制123+manifest修复档案作为历史审阅，保持来源职责边界。
- 采用的假设：原固定回包仅作离线协议反例，新的真实模型效果未知；当前完整源属于原修复和前置规范提交的后代；原素材/供应商/业务运行由协调者继续负责。
- 置信度：本卡离线请求合同、原裁决保持、来源/权限与本机结构高，依据A源码+B真实146案例及标准门禁；新真实模型与影片效果未验证，D。
- 建议复核：producer-gate的7条facts强制文本；原A3true/76字节保持和26条真实请求断言；当前独立actor、三基线及observer真实路径。

## 自检表

- [是] 覆盖了本独立卡全部授权范围，并逐项声明机检、C级裁剪与真实模型边界？
- [是] 自主完成依赖恢复、真实运行、封存，未把可完成事项推给用户或以不必要问句收尾？
- [是] 每项结论有源码/当前实际记录，A/B/C/D准确，历史与当前源分开？
- [是] 完整补丁、前后源身份、案例与原输出可逐行审查，失败历史保持可追踪？
