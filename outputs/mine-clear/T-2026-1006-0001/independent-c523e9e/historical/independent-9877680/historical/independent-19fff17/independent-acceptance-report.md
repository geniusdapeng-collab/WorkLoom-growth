## 覆盖率声明

- 范围内语义审读文件总数：59；精读/同字节继承精读：57；机检：0；明确区域抽样：2；未读：0。
- 两处部分阅读：4126行 vendor 主编排器仅 PRD/G4/Script/Portrait 调用区域；8176行影片脚本仅字幕默认、sidecar、softmux 区域。逐项散列、区域、继承来源和裁剪原因见 independent-source-coverage.json。
- 全5322跟踪文件只做完整复制字节/链接核验（B），不冒称全仓精读。最终11个非证据变更文件均实际读到末尾（A）。

MC-023 已在实际干净提交 `19fff17247c075a2bb6c2bbcd8016db42643f682` 由独立角色 `native-entry-independent-acceptance` 完成本机预览结构验收。正式 acceptance、gate、handoff、handoff 后 gate 均实际退出0，closed1/open0、12项不变量。旧22卡保留76d独立封存，未被本单卡结果覆盖。

| 实际当前验证 | 结果 | 证据等级 |
| --- | --- | --- |
| 正式原生五代理/PRD/G4/Script 合同 | 39/39，无跳过 | B |
| 既有 requirement 两份回归 | 16/16，无跳过 | B |
| 独立额外反例与双角色正向 | 最终11/11；首轮10/1原样保留 | B |
| 四套受影响 Vitest | 91/91，四文件，无跳过 | B |
| industry-contract 必要构建；video自身/server类型 | 全部实际0 | B |

157是测试定义计数，属性重叠，不能解释为157种生产行为。首轮错误正向夹具合计额外11次执行保留，所有测试执行实例为168。当前修复角色自己的39条不重复计入。

**A：** 原有五代理、创意、完整场景和台词继续作为生成来源。实例桥绑定完整当前G3/受控档案/原照片回执；quality取原有合法阈值较严者；PRD/Markdown/G4与实际Script完整角色文本、嵌套metadata在await前后核验。

**A：** 宿主G4在图像模型关闭时仍发送完整原文及所有受控视角，并要求每张图正确path/SHA/image scope回执、await后重新读当前字节。**C：** 原字幕脚本关联区域支持sidecar；requireTimelineValidation字段仅为合同要求。

独立首轮双角色正向断言错误假设规划task.characterId等于档案ID且outputFile已经执行。完整原生源码显示：Script输出character_id，CharacterPlanner只读id/characterId/name，因此原生task使用姓名作为ID；每个planned portrait.archiveAssetId精确保留档案ID，status=pending/outputFile=null直到执行。本轮修正只验证真实规划字段与16角度，原10/1和新11/11均保留，未改产品代码或放松拒绝用例。

另外保留两个执行器元数据guard前置失败，以及不存在video tsconfig.build.json引起的TS5058。正确包exports为src/index.ts、没有build脚本；正式源码测试随后通过，video使用本包声明编译器完成typecheck。这些失败没有被包装成源码修复。

**B/D 边界：** 全部原生处理器、parser、adapter和照片审核接口是实际代码；模型/PG/vendor外部响应由明确替身代替，照片为临时字节夹具。实际ScriptValidator在薄夹具上报告既有低分/修复项，不能据这些fixture声称剧本审美通过。照片字节散列不证明真人同脸、用途许可或画质。未做当前真实模型、媒体、PG、服务、30秒影片、后期或正式发行。原VID1014 G4 score45拒绝和原e0测试专属30条5pass/25fail保持历史原始证据。

完整157条用例的前置条件、步骤、预期与实际结果保存在 independent-test-cases.json；所有命令、stdout/stderr、官方原run/observer、修复原run、覆盖清单及失败史都在本封存目录。

## 收尾报告

- 已完成：MC023正式四步、最终11文件及直接链路审读、必要回归/11反例/91集成/类型检查、独立回执和原始失败留存封存。
- 未完成/未覆盖：授权之外的当前生产模型/整片/发行由协调会话继续；完整主编排器和影片脚本仅所列区域阅读；旧22卡未重跑。
- 自主追加事项及理由：双角色实际规划、非front图片await、异实例PRD、完整description、原生重试完整JSON、nested alias边界，验证当前源合同；自有依赖字节/链接与失败史确保回执可复核。
- 采用的假设：宿主受控档案resolver及原授权作用域保持权威；不选档时保留旧原生叙事；字幕沿用现有sidecar。
- 置信度：本提交本机结构验收高，依据干净同源实际原生处理器与反例；当前真实影片/模型质量未验证。
- 建议复核：实例桥的完整source/async seal；宿主G4图片回执后置复读；official run/observer与原失败及修正夹具。

## 自检表

- [是] 覆盖了全部授权单卡范围并列明裁剪/未覆盖部分。
- [是] 没有把可自主事项推给用户，没有不必要问句收尾。
- [是] 每个结论有可核验依据，A/B/C/D准确，历史与当前角色/提交分开。
- [是] 最终变更全文、实际失败/正向边界、命令与原始证据可逐行审查。
