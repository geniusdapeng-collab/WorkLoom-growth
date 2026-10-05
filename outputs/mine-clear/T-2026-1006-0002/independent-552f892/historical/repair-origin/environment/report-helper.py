#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build MC024 evidence summaries from retained actual runs, never from a claimed status."""
from pathlib import Path
import subprocess
import hashlib
import json
import re
import datetime
import os

CHAT = Path('/Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30')
ROOT = CHAT/'work/growth-facts-scoring-mc024'
OUT = CHAT/'outputs/mine-clear/T-2026-1006-0002'
SOURCE = '5bee55d6a754462ca60cdf2a98bd9b1e6807193d'
RED = '6e0606c78c21d64856b9e9966a445d88ef24fbd7'
AUDIT = 'c523e9e24300755a6f65c018712ad85c1005838d'
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def save(name, body): (OUT/name).write_text(json.dumps(body, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
def load(name): return json.loads((OUT/name).read_text())
def git(args): return subprocess.check_output(['git',*args],cwd=ROOT,text=True).strip()
assert git(['rev-parse','HEAD']) == SOURCE
assert not git(['status','--porcelain'])

original = json.loads((CHAT/'outputs/native-facts-scoring-preparation-c523e9e/coverage.json').read_text())
read_paths = {entry['repositoryRelativePath'] for entry in original['originalScopeFiles']}
read_paths.update([
    'scripts/native-marketing-facts-scoring.test.mts', 'scripts/native-source-restrictions.test.mts',
    'scripts/delivery/mine-clear.mjs','scripts/delivery/evidence.mjs','scripts/delivery/node-test-reporter.mjs',
    'scripts/ci/verify-commit-msg.mjs','packages/industry-contract/src/index.ts',
    'package.json','packages/video-studio/package.json','packages/video-studio/tsconfig.json',
    'apps/server/package.json','apps/server/tsconfig.json','tsconfig.base.json',
    'packages/industry-contract/package.json','packages/industry-contract/tsconfig.json',
    'packages/industry-contract/tsconfig.build.json','apps/server/vitest.config.ts','packages/base/vitest.config.ts',
    'AGENTS.md','AGENTS.repo.md','WORKLOOM_PRODUCT_CONTEXT.md','docs/DEVELOPMENT-PROTOCOL.md',
    'docs/MINE-CLEAR-DELIVERY-SPEC.md','scripts/delivery/README.md',
])
read_paths.update(str(p.relative_to(ROOT)) for p in (ROOT/'scripts/fixtures/marketing-facts-scoring').glob('*.json'))
rows = []
tracked = subprocess.check_output(['git','ls-files','-z'],cwd=ROOT).decode().split('\0')
for name in [p for p in tracked if p]:
    path = ROOT/name
    if path.is_symlink():
        data = os.readlink(path).encode(); file_kind='symlink text'
    else:
        assert path.is_file(), 'Tracked input missing: '+name
        data = path.read_bytes(); file_kind='regular file'
    rows.append({'path':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),
        'fileKind':file_kind,'evidence':'A' if name in read_paths else 'B',
        'method':'Complete source/document/fixture reading; diagnostic sources carried by exact hashes, with approved producer patch reread.' if name in read_paths else 'Metadata/existence/byte digest only; no implementation-understanding claim.'})
missing = read_paths-set(row['path'] for row in rows)
assert not missing, missing
counts = {'total':len(rows),'fullyRead':len(read_paths),'machineOnly':len(rows)-len(read_paths),'sampled':0,'unreadAtIdentityLayer':0}
save('source-coverage.json',{'schema':'workloom.mc024-source-coverage/v1','commit':SOURCE,
    'scope':'Owned tracked checkout identity inventory; implementation reading is explicitly narrower.',
    'counts':counts,'fullyReadPaths':sorted(read_paths),'machineOnlyDoesNotMeanImplementationReading':True,
    'cropReason':'This task changes only mandatory facts request text. Unchanged broader workspace/vendor/PG/media implementations receive identity metadata and affected black-box regressions rather than a whole-repository semantic audit.',
    'originalDiagnosticReading':str(CHAT/'outputs/native-facts-scoring-preparation-c523e9e/coverage.json'),
    'files':rows})

green_ledger=load('repair-green/ledger.json'); card=green_ledger['cards'][0]
assert card['state']=='fixed' and card['fixed_by']=='/root/mc024_facts_scoring_repair' and not card['verified_by']
actual_node=[]
for assertion in card['assertions']:
    run=load('repair-green/'+assertion['run']['path'])
    summary=load('repair-green/'+run['node_observer']['summary']['path'])
    assert run['commit']==SOURCE and run['result']=='pass' and summary['failed']==0 and summary['passed']>0
    actual_node.append({'run':assertion['run'],'summary':summary,'output':run['outputs'][0]})
assert [entry['summary']['tests'] for entry in actual_node]==[26,30]

vitest=load('producer-facts-authority-vitest.json'); specific=load('single-own-fixture-video-vitest.json')
assert vitest['numPassedTests']==89 and vitest['numFailedTests']==0 and vitest['numPendingTests']==1
assert specific['numPassedTests']==1 and specific['numFailedTests']==0
passed_vitest={a['fullName'] for suite in vitest['testResults'] for a in suite['assertionResults'] if a['status']=='passed'}
passed_vitest.update(a['fullName'] for suite in specific['testResults'] for a in suite['assertionResults'] if a['status']=='passed')
assert len(passed_vitest)==90
save('validation-summary.json',{'schema':'workloom.mc024-validation-summary/v1','commit':SOURCE,
    'officialRed':{'commit':RED,'tests':26,'passed':21,'failed':5,'root':'repair-current','runId':'MC-024-0-1791240490774'},
    'officialGreen':actual_node,'nodeUniqueCases':56,
    'closestVitestInitial':{'tests':90,'passed':89,'failed':0,'skipped':1,'report':'producer-facts-authority-vitest.json'},
    'exactSyntheticVideoClosure':{'actualPassed':1,'failed':0,'other39FilteredNotRerun':True,'report':'single-own-fixture-video-vitest.json'},
    'closestVitestDistinctCaseUnion':{'tests':90,'passed':90,'failed':0,'uncovered':0},
    'distinctCasesAcrossNodeAndVitest':146,'passedCasesAcrossNodeAndVitest':146,
    'builtIndustryContract':load('operations/build-owned-industry-contract.run.json')['exitCode'],
    'videoTypecheckExitCode':load('operations/video-studio-typecheck.run.json')['exitCode'],
    'serverTypecheckExitCode':load('operations/server-typecheck.run.json')['exitCode'],
    'taskCommitFormatExitCode':load('operations/task-commit-msg-check.run.json')['exitCode'],
    'repairGateExitCode':load('operations/repair-gate-before-independent.run.json')['exitCode'],
    'repairHandoffExitCode':load('operations/repair-handoff-before-independent.run.json')['exitCode'],
    'realModelOrProviderCalls':0,'pgCalls':0,'customerOrVendorMediaWork':0,
    'deterministicSyntheticLocalFfmpegTest':True,
    'modelSemanticOutcome':'D: unknown; all HTTP model replies in tests are fixed independent protocol fixtures.',
    'roleState':'fixed; acceptance baseline and independent role absent; gate/handoff correctly rejected.'})

def tap_cases(text): return [(match.group(2), 'failed' if match.group(1) else 'passed') for match in re.finditer(r'^(not )?ok \d+ - (.+)$',text,re.M)]
red_run=load('repair-current/runs/MC-024-0-1791240490774.json')
red_cases=tap_cases((OUT/'repair-current'/red_run['outputs'][0]['path']).read_text())
green_cases=tap_cases((OUT/'repair-green'/actual_node[0]['output']['path']).read_text())
assert len(red_cases)==len(green_cases)==26
prep_cases=json.loads((CHAT/'outputs/native-facts-scoring-preparation-c523e9e/cases.json').read_text())['cases'][:26]
assert len(prep_cases)==26
cases=[]
for i,(case,(red_name,red_status),(green_name,green_status)) in enumerate(zip(prep_cases,red_cases,green_cases),1):
    assert red_name==green_name and green_status=='passed'
    result={key:value for key,value in case.items() if key not in ['actualOriginal','actualProposedPatch']}
    result.update({'id':'MC024-N'+str(i).zfill(2),'testName':green_name,'source':'scripts/native-marketing-facts-scoring.test.mts',
        'actualFormalRed':red_status,'actualFormalGreen':green_status,'redCommit':RED,'greenCommit':SOURCE,
        'formalRedRun':'repair-current/runs/MC-024-0-1791240490774.json','formalGreenRun':actual_node[0]['run']['path'],
        'preconditions':['Clean immutable test-only/source commits, original JSON byte fixtures and fixed HTTP replies independent of request keywords.']+case.get('preconditions',[])[1:]})
    cases.append(result)
regression_text=(OUT/'repair-green'/actual_node[1]['output']['path']).read_text()
native_cases=tap_cases(regression_text); assert len(native_cases)==30 and all(status=='passed' for _,status in native_cases)
for i,(name,status) in enumerate(native_cases,1):
    cases.append({'id':'MC024-R'+str(i).zfill(2),'testName':name,'preconditions':['Owned SOURCE checkout, fixed model transports, local temporary source stores, native production boundary mocked by the existing tests.'],
        'steps':['Execute the unmodified native review/extraction/dossier/restriction regression test and its concrete source assertions.'],
        'expected':name,'actual':status,'sourceFiles':['scripts/native-marketing-review.test.mts','scripts/native-marketing-extraction.test.mts','scripts/native-marketing-dossier.test.mts','scripts/native-source-restrictions.test.mts'],
        'run':actual_node[1]['run'],'commit':SOURCE,'executionEvidence':'B','semanticModelClaim':False})
for suite in vitest['testResults']:
    for assertion in suite['assertionResults']:
        name=assertion['fullName']; closure=name in passed_vitest
        assert closure
        cases.append({'id':'MC024-V'+str(len(cases)-55).zfill(2),'testName':name,
            'preconditions':['Owned SOURCE implementation; local test-only HTTP servers, source fixtures and temporary files.', 'Synthetic video case separately uses the existing pinned ffmpeg/ffprobe on its own lavfi fixture.'],
            'steps':['Execute the unmodified test with its source assertions; sole initially skipped video case executed separately by exact full-name filter.'],
            'expected':assertion['title'],'actual':'passed','initialRunStatus':assertion['status'],
            'actualClosure':'single-own-fixture-video-vitest.json' if assertion['status']!='passed' else 'producer-facts-authority-vitest.json',
            'source':str(Path(suite['name']).relative_to(ROOT)),'commit':SOURCE,'executionEvidence':'B'})
assert len(cases)==146
save('test-cases.json',{'schema':'workloom.mc024-actual-test-cases/v1','commit':SOURCE,'totalDistinctCases':146,'passed':146,
    'countsAreAUnionOfRetainedActualRunsNotFilteredOuterWrappers':True,'cases':cases})

save('environment-attempt-history.json',{'schema':'workloom.mc024-environment-history/v1','incidentTruth':'Original lost run is not reconstructed as an actual artifact.',
    'attempts':[
        {'runId':'MC-024-0-1791239921092','commit':RED,'actualTests':0,'error':'Sparse checkout omitted shot-intent.mjs','originalDiskRunLost':True,'evidence':'D: tool-observation-derived historical metadata only; not a formal red'},
        {'runId':'MC-024-0-1791240366537','commit':RED,'actualTests':0,'error':'Task-owned workspace dependency links lacked shared package zod','originalDiskRunLost':False,'root':'repair-current','validFormalRed':False},
        {'runId':'MC-024-0-1791240490774','commit':RED,'actualTests':26,'passed':21,'failed':5,'root':'repair-current','validFormalRed':True},
        {'runId':'MC-024-1-1791240860635','commit':SOURCE,'actualTests':30,'passed':29,'failed':1,'error':'Sparse checkout omitted dynamically-read media-catalog.json','root':'repair-green','validFinalGreen':False},
        {'runId':actual_node[1]['run']['path'],'commit':SOURCE,'actualTests':30,'passed':30,'failed':0,'root':'repair-green','validFinalGreen':True},
    ],'recovery':'Complete tracked checkout after disk recovery; dependencies resolve to task-owned workspace sources; formal artifactRoot is outside the checkout and all later actual runs retained.',
    'productionPatchAttempts':1,'originalRuntimeOrPackagedPreparationModified':False})

fingerprints={name:digest(ROOT/name) for name in ['packages/video-studio/src/producer-gate.ts','scripts/native-marketing-facts-scoring.test.mts']}
tools={str(path):digest(path) for path in [Path('/Users/mac/.workloom-color/bin/ffmpeg'),Path('/Users/mac/.workloom-color/bin/ffprobe')]}
save('repair-receipt.json',{'schema':'workloom.mc024-formal-repair-receipt/v1','taskId':'T-2026-1006-0002','issue':'https://cnb.cool/workloom-ai/WorkLoom-growth/-/issues/332',
    'actor':'/root/mc024_facts_scoring_repair','role':'repair','branch':'task/T-2026-1006-0002','auditCommit':AUDIT,'testOnlyCommit':RED,'productionCommit':SOURCE,
    'sourceFingerprints':fingerprints,'pinnedSyntheticMediaBinaries':tools,'state':'fixed','independentAcceptance':False,
    'mcdOperationalArtifactRoot':str(OUT/'repair-green'),'redOriginalArtifactRoot':str(OUT/'repair-current'),
    'archivesAreOriginalByteCopiesNotNewExecutions':True,'realModelOutcomeVerified':False,'originalApprovedTrue76StillDeniedAt85':True,
    'realModelOrProviderCalls':0,'pgCalls':0,'customerOrVendorMediaWork':0,'deterministicSyntheticLocalVideoTest':True,
    'pendingCoordinatorSteps':['Independent acceptance on the combined final source commit','Remote PR/review/publication','New authorized native preproduction honoring its original model verdict']})

report=f'''# MC-024 正式修复回执 · T-2026-1006-0002

## 覆盖率声明
- 范围内受控文件总数：{counts['total']}；精读：{counts['fullyRead']}；机检/元数据解析：{counts['machineOnly']}；抽样：0；未读：0（文件身份层）。
- 精读清单与每项摘要见 `source-coverage.json#fullyReadPaths`。其它 {counts['machineOnly']} 项仅核对存在、字节数与摘要，未作实现层精读，不能据此形成全仓代码审计结论。
- 阅读裁剪：本卡只替换 facts 强制提示。既有 workspace/vendor、PG、媒体生成与平台治理的更广实现采用身份机检和最近受影响黑盒回归；理由是本卡没有修改这些实现，且未授权真实模型、PG或客户/供应商媒体调用。本地自行生成的视频编解码测试按协调者后续澄清真实执行。

## 实证与最小修复
- **A**：`producer-gate.ts:522@{AUDIT}` 的“缺证据必须拒绝”没有区分诚实 no_evidence 与已经提出却无支持的主张。新强制文本明确 score 只评主张支持关系、status/noEvidenceReason 和来源限制的忠实性；检索数量、相关性、市场覆盖不足保留在 issues/suggestions。默认和自定义 rubric 都经过这些强制文本。
- **A**：虚假空值、理由不实、否定/限定/型号/数字/单位冲突、来源限制遗漏仍要求拒绝；诚实空值仍由模型对完整原文独立审核，不预设批准和分数。HTTP、归档、解析、批次、接口和 minScore 没有修改。
- **B**：原 VID-1015 / RUN-edfd69c7 A3 字节保持：review SHA256 `5334c64f2a145c0ed788e18387cd80fd453e914b3c314da2e6bb6fdfae0c5884`；judge-exchange `023e2b206de3ef2f69aca7ecd63f03c862b59574236aaf28dc5a535913c57fd0`。原 true/76 按85门槛继续失败，固定回包不根据提示词加分。
- **D**：新真实模型是否遵循评分域、会返回什么分数尚未知；本卡离线协议断言不构成真实语义审核或成片通过。

## 提交与正式运行
- 源审计：`{AUDIT}`；本会话实际匿名 fetch 保存了 argv、时刻、退出码，main 是审计源祖先。为了记录干净审计源，暂时切换到本会话拥有的 detached c523，init 后切回本任务分支，未改写分支历史。
- 测试先行：`{RED}`，仅7个测试/fixture文件，生产 gate 字节与 c523 相同；正式26项为21通过、5失败。
- 最小生产修复：`{SOURCE}`，仅 gate 9行插入、2行删除，拟补丁完整20行文本；任务提交格式与秘密扫描通过。
- 标准 MCD 当前原始红目录为 `repair-current`，绿目录为 `repair-green`。目录不移动，Node observer 的真实绝对 destination、reporter 身份与字节摘要保持可回读；源码仓封存目录只是原字节审阅副本，不假称一次新的实际运行。

## 验证结果
| 维度 | 实际结果 | 原始证据 |
|---|---|---|
| MC024 请求合同、真实原字节、85边界、缺模型/非法结构/归档失败与非facts阶段 | 正式红21/26通过、5失败；生产修复绿26/26通过 | `repair-current` / `repair-green` 受控 Node运行与机器摘要 |
| 现有事实审核、抽取、原生档案与来源限制并发/脱离作用域回归 | 30/30通过；固定 HTTP回包与原生生产边界替身 | `repair-green` 第二条断言 |
| 最近监制、逐主张事实与权限回归 | 原90项89通过、1跳过；同源SHA精确单例1通过，案例并集90/90通过 | `producer-facts-authority-vitest.json` / `single-own-fixture-video-vitest.json` |
| 类型与构建 | 自有 industry-contract 实际构建、video-studio / server 类型检查退出0 | `operations` 中各完整运行记录 |
| 修复角色资格 | state=fixed；acceptance为空；gate与handoff按预期拒绝，只有2条缺独立验收错误 | `operations/repair-gate-before-independent.*` / `repair-handoff-before-independent.*` |

总计146个不同案例均有本机实际通过记录。详见 `test-cases.json` 的前置、步骤、预期、实际和源/运行定位。最初的90项结果和精确补跑结果分开保存；39条因精确过滤未执行的条目不重新计数，也不冒充本次执行。

## 环境失败与恢复
首个临时0测试加载失败来自漏选 shot-intent.mjs；Git sparse 更新随后删除了未入 cone 的 ignored 临时证据。本会话应当先把临时证据复制到外部，该失误已经在 `environment-incident.json` 如实记录。丢失原run没有重新制造；工具观察摘录只有D级，不算正式红。其后的0项workspace依赖失败和30项中1项动态 media-catalog 缺失失败均保留原run。磁盘恢复后完整检出受控文件、补齐各workspace只读依赖链接，正式26红以及26+30绿均实际执行；没有更改旧客户运行归档或前期封存。详见 `environment-attempt-history.json`。

## 收尾报告
- 已完成：Issue332/路径锁回读；独立任务工作树与匿名修前fetch；测试先行干净提交；有效26项正式红；最小生产提示修复；26+30正式修复绿；最近90项案例并集闭环；必要构建/两类型检查；原回包与失败证据保存；修复回执和清单。
- 未完成/未覆盖：本修复角色不执行独立验收或远端写操作；新真实模型结果、生产发行和成片由协调者继续完成。MCD要求“修复通过只进入 fixed，未参与修复的独立角色实际运行后才进入 verified”；[对应SKILL.md](/Users/mac/.codex/skills/mine-clear-delivery/SKILL.md)。不把本地通过当生产效果。
- 自主追加事项及理由：为覆盖调用面增加既有审核/抽取/原生档案/来源限制及权限回归；独立workspace别名指向本任务源码；磁盘恢复后撤销稀疏检出以消除动态依赖缺口；按协调者明确范围真实补跑唯一synthetic视频用例，未复跑其它89项。
- 采用的假设：原始固定回包只用来验证协议和不可变裁决；新模型语义效果未知。父任务的9df仅文档/独立证据封存，产品代码仍与c523相同，后续用普通merge接续。
- 置信度：请求合同、原判保持和受影响回归高（A代码与B实际运行）；新真实模型/生产效果低、尚未验证（D）。
- 建议复核：facts强制7条文本；原true/76保持失败和完整回包字节；独立角色对最终组合提交运行MCD的真实回执。

## 自检表
- [是] 覆盖本卡修复角色全部范围，并显式声明广域实现阅读裁剪与真实模型边界。
- [是] 可自主完成的环境恢复、回归和封存已经完成，没有不必要的问题交给用户。
- [是] 正式红绿与历史环境失败区分准确；0测试不算通过，丢失run不重造，证据等级不冒充。
- [是] 补丁、原字节与每个实际case可追踪，满足逐行代码与协议审查；修复者没有自称独立verified。
'''
(OUT/'REPAIR-REPORT.md').write_text(report,encoding='utf-8')
print(json.dumps({'source':SOURCE,'trackedIdentityFiles':counts,'actualDistinctPassedCases':146,'state':'fixed','receipt':str(OUT/'repair-receipt.json')},ensure_ascii=False))
