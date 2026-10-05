# T-2026-1006-0001：原生 PRD 的档案、交付合同与 G4 实物证据

## 覆盖率声明

- 范围内文件总数：80；精读：60；机检/脚本解析：16；抽样：4；未读：0。逐项清单与裁剪理由见同目录 `outputs/mine-clear/T-2026-1006-0001/coverage.json`。

本记录的范围是 MC-023 的 G3 → 原生五代理 PRD → G4 → 实际 ScriptEngine/PortraitStudio，以及宿主 G4 照片接线。具体文件、完整源码散列和 A/B/C/D 分类保存在本任务的外部修复证据目录 `outputs/mine-clear/T-2026-1006-0001/`；修复角色完成后生成独立 `coverage.json`。这份源码记录不把前一任务的全仓检查或旧验收当作当前修复验收。

修改前完整读取被改文件、新适配器直接依赖与改动调用链；无关旧宿主 imports、模型路由/provider 内部及完整制作链路不在本卡语义审计范围。完整原生 PRD、五代理、schema、summary、ScriptEngine、ScriptGenerator、adapter、PortraitStudio、宿主与照片运行器均精读。超过本卡直接链路的后期引擎、完整影片脚本与 MCD 执行器只读明确关联区域，其完整文件以机检或抽样记录，不称为精读。

## 问题与证据分级

- **A，历史真实运行**：VID-1014 在 G1/G2/G3 分别得到 80/76/82，G4 得到 45 并拒绝。原生 PRD 把已选“客户方 CEO”写为林总/中年，平台推为通用，两套阈值不一致，缺字幕口径，评审只有照片文字。原始 `G4_PRD.md` 散列为 `32ab483d48ca969098a79f3bd101e2f9a1e7aef2f84fcc32ee07ae619169e615`，历史来源是 `9c69b8ca013d1ef67e905dee89303078f208faca`；保留原拒绝，不改分数或解释为通过。
- **A，代码精读**：原生 `PRDGenerator.generate` 独立运行五代理，没有消费宿主 G3 编译对象或档案照片。native create 在确认后将 `_prd` 交给 ScriptEngine，PRD 异常又会生成 minimal PRD；带 suggestions 的批准会直接重生成新 PRD而不重新确认。宿主原 G4 只有完整正文文件，没有原图附件。
- **A，实际反例**：测试专属提交 `e0f496c67804b91b7dc44bf72c2c39a6a588381b` 的正式 MCD 修复运行为 30 条、5 通过、25 失败、0 跳过，实际退出 1。原始红日志及 observer 回执保留。修正夹具使用原生数组平台、`character_id` 及实际 `context.characters` 后，在 `529acb3ebde112a4cc424af06d7aa2641ab783a5` 再跑红基线，30 条中 6 通过、24 失败、退出 1；这不是另一次真实生产运行。
- **B，测试观察**：使用实际 CJS PRD 五代理、解析器、原生 ScriptEngine/parser/adapter/PortraitStudio，仅替换模型响应及 vendor 未取消的测试超时器；宿主集成替换数据库与 vendor 边界。照片为临时字节夹具，不能证明真人同脸、美学质量或真实模型批准。

## 修法与权衡

对比直接改 vendor / 另建 PRD 管线，与现有实例适配器：前者引入第三方源码分叉或平行流程；选用现有 VideoStudio 生命周期内的实例适配器，仍由原生五代理产生创意、完整场景、镜头映射和台词，宿主只绑定同份受控来源并拒绝不一致。

`native-requirement-contract.ts` 提供私有作用域 getter，原已批准权威字段保持冻结；新 `native-prd-contract.ts` 不信任公共 metadata 自报来源。两个原生代理的现有提示词和每次请求重建的实例 system 内容收到完整 G3、档案身份/年龄/外貌/衣服/性格/授权作用域及当前原图回执。生成后的角色必须逐一具有准确档案姓名；缺失、新增、重名、ID/姓名冲突都拒绝，不根据单一角色猜测或重命名。只有匹配成功才从同份档案绑定角色字段与真实 front/全照片路径。

制作与验收的 visual/audio/narrative/consistency 取原有合法值的较大值，兼容原 schema 的 Score 别名。未知或越界值拒绝；失败预案保留动作，但不再允许较低阈值自报交付通过。字幕合同采用现有 `full-chain-film.mts` 的缺省 sidecar：母版不烧字、SRT/ASS/VTT 旁挂、软字幕轨及时间轴回读要求。此处是制作要求，`requireTimelineValidation` 不是已发生的验证结果。

PRD 内容、完整 Markdown、系统 G4 结果和 ScriptEngine 入参/产出绑定同一个实例与散列。未审核、拒绝、minimal、clone、异实例、改正文、改源档案/Brief/洞察/原照片，以及建议导致未审核重生成，均失败关闭。原生 create 的时长别名和事实红线追加仍可在 G4 前完成。实际 builder 原样透传完整 characters；脚本入口核对完整角色文本（包括 description 与 ID 别名），随后仅补受控 portraitPaths。内部 `_metadata` 不得覆盖 PRD 或画幅；整个内部对象在 ScriptGenerator await 前后哈希，并复核 blueprint 与 adapter 的输出画幅，保留同源且稳定的原生 creativeIntensity 扩展。实际 await 内嵌套画幅篡改反例先退出 1，修后拒绝，稳定扩展正例通过。所有异步边界在 await 前后复读来源与文件。实际 BaseAgent 的 PARSE 重试仍保留原生创意提示词压缩，但每次实例 system 内容重建完整档案 JSON，防止尾部截断。首个片段检查探测实际通过，完整 JSON 检查才实际复现退出 1；两次原输出均保留，片段命中不作为完整来源证据。

宿主始终把完整人物属性、原授权/验证作用域和已选原图回执投影到需求档案，独立于图像模型开关。G4 的真实 `reviewStage` 同一批得到完整原生正文与所有已选照片；每张照片需匹配实际路径、散列和 image scope 的回执，await 后再读原文件。缺角度、空/缺图、错散列、重名、符号链接、同物理文件冒充多个视角及超过现有 60 张监制预算都拒绝，不静默丢图。字节散列只证明当前输入，不升级原真人身份、素材授权或历史验收范围。

## 实际验证与边界

修复工作树实际执行：新增原生合同 39 条、四套既有原生来源/需求回归 37 条、三套宿主集成 87 条、七套照片/监制/原生素材集成 139 条，均退出 0、无跳过；视频包和服务包类型检查退出 0。合计 302 条不同测试定义。前两次新宿主夹具因语速格式错误失败，类型检查发现新夹具推断 unknown；分别按原有 `2字/秒` 格式和 const tuple 修正，原失败文件保留，没有改守卫或源码协议。

正式 MCD 修复断言在包含此记录的干净完整提交再实际执行，首个干净提交 `93b0469c18ee1d03e0606fb2133bb6538db35b89` 的正式 37 条修复回执已实际通过，但随后嵌套元数据反例暴露边界，故它仅为历史中间基线；最终完整提交再次实际执行全部 39 条。修复角色最多写 fixed；独立角色在最终 SHA 实际执行后才能写 verified。工作树测试不代表正式 source HEAD 验收。

本卡不改变 producer rubric、评审模型、分数阈值、原始拒绝、客户档案/照片、vendor 源码、数据库或渲染入口。没有真实模型、图像、视频供应商调用，没有提交付费制作。完整当前预生产、原输入 30 秒影片、后期和正式发行由协调会话在独立修复验收后继续实测。产品投影唯一约束的历史 P2 另记录，本卡不修改它。

## 收尾报告

- 已完成：同份 G3/档案来源注入；严格人物对应与照片复用；统一原有较高阈值；现有字幕合同；G4 全原图附件及回执复读；PRD 确认/脚本完整文本/异步隔离失败关闭；相关回归和类型检查。
- 未完成/未覆盖：真实 G4/最终影片/正式发行不由修复角色执行；独立验收等待完整提交；未把临时照片夹具当作人脸或画质验收。
- 自主追加事项及理由：封闭 ScriptGenerator 实际消费的可变 description/character_id/portraitPaths 和内部元数据覆盖；同物理图重复及 60 张现有预算前置拒绝，防止照片清单自称完整。
- 采用的假设：已选档案和原图仍以宿主现有 resolver、原授权与当前验证作用域为来源；未选档案保留原生叙事角色生成；字幕模式沿用现有缺省 sidecar。
- 置信度：结构合同与源码修复高，依据真实原生组件和反例回归；真实模型质量与影片结果未验证。
- 建议复核：新实例适配器的完整角色/来源边界；宿主 G4 的实际图片附件及后置回执；正式干净提交的独立角色证据。

## 自检表

- [是] 覆盖了本卡全部授权修复范围，没有用旧验收代替当前修复？
- [是] 可自主完成的事项已完成，没有抛给用户或以问句收尾？
- [是] 来源、实际测试与历史生产的证据等级和适用提交分别声明？
- [是] 改动有失败路径、并发/篡改反例与原文证据，可逐行审查？

## MCD 修复执行信息

- 档位 C/M5；local-preview；修复角色 mc023-prd-authority-repair；独立角色尚未执行。
- 审计76d、测试红e0(5/30)与529(6/30)、正式历史绿93b(37/37)及嵌套await真红均逐项保留。
- 最终39核心 +37既有来源 +87宿主 +139照片/监制 =302不同定义；重跑不加定义。工作树绿和正式提交绿分别描述。
- 源码外的原始Node输出含 vendor 原格式尾随空白，按不可修改证据保留；git diff --check 对源码/文档实际通过。全diff曾因原始证据空白退出2，未篡改证据或放宽源码门禁。
- 抽样清单及原因：
  - `scripts/tools/full-chain-film.mts`：Named subtitle/default/mux regions only; full 8000+ line production and actual film are owned by the root.
  - `packages/video-studio/src/film-worker-runtime.ts`：Named type/contract regions only; no film-worker invocation in this repair.
  - `scripts/delivery/mine-clear.mjs`：Actual init/invariants/add/run-assertions usage and named helper regions; not a full executor audit.
  - `vendor/supermickey/hyperreality-system/engines/post-production-engine/post-production-engine.js`：Read 1-600 of 904 lines; its identity-card postprocessing does not define the host full-chain subtitle contract.
