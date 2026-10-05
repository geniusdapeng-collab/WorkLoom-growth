## 覆盖率声明

- 范围内文件总数：61；精读：58（本次新精读 1，旧读 57 经当前完整字节相等检查继承）；机检/脚本解析：0；抽样：3；未读：0。
- 独立全量元数据比对：5322 个跟踪文件，证据 B，与语义范围重叠，不算5322精读。
- 抽样清单及原因：vendor index.js 4126 行的 PRD/G4/Script/Portrait 段；full-chain-film.mts 8176 行字幕段；vendor-compat.ts 2053 行入口/共享桥/Phase3 段。具体行区间、哈希、未读部分在 independent-source-coverage.json。与本卡无关的 provider/render/publication 段未精读。

当前 **98776805f108105a6f5891f1bb3f700331848c78** 的 MC-023 本机预览结构验收通过。正式独立39/39、C1精准目标1/1，gate/handoff/postgate均实际exit0；MC-023在此local-preview handoff中闭合1、未闭合0。修复人与验收人不同。本次40是测试定义数，不能当40种生产行为。

| 项目 | 当前实际结果 | 证据 |
|---|---|---|
| MC-023 原生五Agent→Markdown/G4→Script/Portrait合同 | 39/39，0失败/跳过/取消/todo | B，官方run和observer |
| C1 runPreproduction实际安装入口 | 1通过；另外30按-t过滤未执行 | B，Vitest JSON及原始输出 |
| gate / handoff / handoff后gate | 0 / 0 / 0 | B，原目录命令回执 |
| 当前对19fff17完整跟踪字节 | 5322文件，仅vendor-compat.test.ts变动 | B，source-byte-rebinding.json |
| 19fff17旧16/11/91和构建/类型检查 | 精确保留旧SHA证据，本次未重跑 | B，historical/independent-19fff17 |

A：当前C1 fixture使用真实PRDGenerator、ScriptEngine和原始确认方法，检查8个实例合同方法在create时安装；成功与预算拒绝两轮结束后检查原方法恢复。C：兼容入口的指定实际实现区间连接共享Phase3桥，其余兼容代码未重新全读。A57旧语义结论仅在整文件字节与封存19一致后继承。B：39官方源权威边界与精准入口实际通过。D：没有关于当前真实模型G4得分、视觉质量、实际画像、30秒成片或发布结果的结论。

C1使用离线Phase3数据与模型响应替身；不会执行真实需求发现/PRD生成或提供商调用。本次官方39使用原生五Agent/parser/adapter与受控响应、照片字节fixture。它们是结构合同证据，不是画面或真实审批凭证。未放宽验收分数、未手写创意替代原PRD、未改vendor或产品源码。

完整保留原始VID1014 G4 Markdown、e0历史30总/5通过/25失败、19fff17独立fixture首轮失败与修正轨迹。旧bundle字节一致复制到历史子目录；旧observer路径保持原值，归档副本未冒充可迁移gate目录。本次恢复时重复启动helper被目录已存在守卫拒绝，发生于测试之前，已有成功证据保持原字节。

正式执行目录为 work/growth-native-acceptance-9c69b8c/outputs/mine-clear/T-2026-1006-0001/independent-9877680；两个交付副本只作为相同字节归档。receipt为actor/source绑定的SHA256审计回执，并非密码学签名。执行环境未注入任何provider key，禁用ffmpeg/ffprobe；本验收者未进行模型付费、媒体、数据库或服务操作。

## 收尾报告

- 已完成：987精确SHA单卡重绑、5322文件完整机检与唯一变动验证、39官方断言、C1精准1条、gate/handoff/postgate、当前独立actor回执、旧19完整历史原字节保留和新封存副本哈希验收。
- 未完成/未覆盖：C1其余30条按授权精准目标过滤；旧16/11/91/types/22卡未重复；真实模型/视觉/媒体/PG/服务/成片/发布在本角色授权外，由协调者处理，不把本报告称为生产实测。
- 自主追加事项及理由：保存重复启动helper目录守卫拒绝，避免覆盖已完成原始证据；复制旧19完整封存作为source-bound历史，以便核对旧失败和继承证据。
- 采用的假设：仅测试fixture变动时，旧19生产源证据可由当前全量字节比对支持，但旧执行仍属于19，不能改标签为987新运行。
- 置信度：高，范围内当前断言、actor/角色/三基线、原始输出和整文件相等均可重算；当前真实生产品质没有推断。
- 建议复核：官方run与observer绝对路径；C1完整fixture和30过滤列表；source-byte-rebinding及旧19receipt边界。

## 自检表

- [是] 覆盖了授权任务全部范围，而非挑了容易的部分；未覆盖范围逐项明示。
- [是] 没有把可自主完成事项推给用户，没有不必要问句收尾。
- [是] 每个结论有依据，A/B/C/D准确，旧证据保留原SHA。
- [是] 经得起资深工程师逐行审查，源码范围/原始失败/未验证边界均可核对。
