"""Seal current987 MC023 plus one C1 target; preserve19 source-bound history."""
import collections,copy,datetime,hashlib,json,pathlib,re,shutil,subprocess
CHAT=pathlib.Path(__file__).resolve().parent.parent
ROOT=CHAT/'work/growth-native-acceptance-9c69b8c'
HEAD='98776805f108105a6f5891f1bb3f700331848c78'
OLD='19fff17247c075a2bb6c2bbcd8016db42643f682'
ACTOR='native-entry-independent-acceptance'
BASE=ROOT/'outputs/mine-clear/T-2026-1006-0001/independent-9877680'
PREVIOUS=CHAT/'outputs/native-prd-independent-19fff17'
MIRROR=CHAT/'outputs/mine-clear/T-2026-1006-0001/independent-9877680'
DELIVERABLE=CHAT/'outputs/native-prd-independent-9877680'
NOW=datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text())
def write(p,v):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def ref(p):return {'path':p.relative_to(BASE).as_posix(),'sha256':sha(p)}
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT)
def clean():
 assert git('rev-parse','HEAD').decode().strip()==HEAD and not git('status','--porcelain')
clean();assert not (BASE/'independent-acceptance-receipt.json').exists(),'Seal only once'
prior_manifest=read(PREVIOUS/'independent-archive-manifest.json')
for row in prior_manifest['files']:
 assert sha(PREVIOUS/row['path'])==row['sha256']
historical=BASE/'historical/independent-19fff17'
shutil.copytree(PREVIOUS,historical)
for row in prior_manifest['files']:assert sha(historical/row['path'])==row['sha256']
assert sha(historical/'independent-archive-manifest.json')==sha(PREVIOUS/'independent-archive-manifest.json')
for source,target in [(CHAT/'work/native-mc023-rebind-execution.py',BASE/'environment/rebinding-execution-helper.py'),
 (pathlib.Path(__file__),BASE/'environment/rebinding-report-helper.py')]:
 target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
write(BASE/'environment/relaunch-guard-rejection.json',{'schema':'workloom.independent-helper-attempt/v1','source_commit':HEAD,
 'actor':ACTOR,'grade':'B','operation':'python3 work/native-mc023-rebind-execution.py','actual_exit_code':1,
 'observed_error':'FileExistsError: independent-9877680 already exists, BASE.mkdir(exist_ok=False) at line22',
 'reason':'After context recovery, existing successful raw evidence was discovered; helper refused to overwrite it.',
 'tests_started_in_relaunch':False,'source_modified':False,'raw_type':'Recorded actual tool outcome, not a reconstructed execution log.'})
rebinding=read(BASE/'source-byte-rebinding.json')
assert rebinding['source_commit']==HEAD and rebinding['previous_commit']==OLD
assert rebinding['complete_tracked_files']==5322 and rebinding['changed_files']==['packages/video-studio/src/vendor-compat.test.ts']
names=[p.decode() for p in git('ls-files','-z').split(b'\0') if p]
assert len(names)==len(rebinding['trackedFiles'])==5322
for row in rebinding['trackedFiles']:
 p=ROOT/row['path'];digest=hashlib.sha256(str(p.readlink()).encode()).hexdigest() if p.is_symlink() else sha(p)
 assert digest==row['sha256']
oldcoverage=read(historical/'independent-source-coverage.json')
rows=[]
for row in oldcoverage['files']:
 q=copy.deepcopy(row);assert sha(ROOT/q['file'])==q['sha256']
 q.update(source_commit=HEAD,read_at_commit=q.get('read_at_commit',OLD),carried_from_commit=OLD,
  provenance_inventory='historical/independent-19fff17/independent-source-coverage.json',exact_bytes_unchanged=True,
  method='Earlier semantic grade carried after current complete tracked-byte and whole file SHA256 equality; not a fresh reading claim.')
 rows.append(q)
for path,grade,regions,reason in [
 ('packages/video-studio/src/vendor-compat.test.ts','A',[],None),
 ('packages/video-studio/src/vendor-compat.ts','C',['1-95','383-440','770-790','1360-1450','1754-2053'],
  'Changed C1 fixture and actual shared install/Phase3 execution/cleanup links only; unrelated compatibility bridges not fully re-audited.')]:
 p=ROOT/path;assert git('show',HEAD+':'+path)==p.read_bytes()
 q={'file':path,'grade':grade,'source_commit':HEAD,'read_at_commit':HEAD,'sha256':sha(p),'lines':len(p.read_bytes().splitlines()),
  'method':'Complete semantic read 1-260/261-520/521-780/781-EOF.' if grade=='A' else 'Explicit targeted semantic regions at current immutable source.'}
 if regions:q.update(regions=regions,scope_cut_reason=reason)
 rows.append(q)
grades=collections.Counter(r['grade'] for r in rows);assert len(rows)==61 and grades=={'A':58,'C':3}
coverage={'schema':'workloom.independent-source-coverage/v1','source_commit':HEAD,'scope':'MC023 current source rebinding plus changed C1 actual installation target',
 'counts':{'total':61,**{g:grades[g] for g in ['A','B','C','D']}},'new_complete_reads':1,'carried_complete_reads':57,
 'changed_files':['packages/video-studio/src/vendor-compat.test.ts'],'files':sorted(rows,key=lambda r:r['file']),
 'partial_and_unread_list':[r for r in rows if r['grade']!='A'],
 'complete_tracked_copy_identity':{'grade':'B','files':5322,'reference':'source-byte-rebinding.json',
  'meaning':'Whole source/archive metadata comparison overlaps semantic scope; 5322 files are not 5322 semantically audited files.'},
 'grade_definitions':oldcoverage['grade_definitions'],
 'exclusions':['Old22 cards and unrelated suites were not repeated.','Only1 of31 C1 file tests executed;30 are filtered pending, not passing.',
  'Old19 requirement16/independent11/affected91/build/types are preserved source-bound evidence; no current987 execution claim.',
  'No live providers/models, actual G4 approval, image/face quality, paid operations, media creation, Postgres, services, full film or release evidence.']}
write(BASE/'independent-source-coverage.json',coverage)
for path in ['packages/video-studio/src/vendor-compat.test.ts','packages/video-studio/src/vendor-compat.ts']:
 p=BASE/'reviewed-source'/path;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(ROOT/path,p)
ledger=read(BASE/'ledger.json');assert ledger['baseline']['repair']['commit']==HEAD==ledger['baseline']['acceptance']['commit']
assert len(ledger['cards'])==1
card=ledger['cards'][0];assert card['id']=='MC-023' and card['state']=='verified' and card['verified_by']==ACTOR and card['fixed_by']!=ACTOR
runref=card['assertions'][0]['run'];run=read(BASE/runref['path']);assert sha(BASE/runref['path'])==runref['sha256']
summary={'total':39,'passed':39,'failed':0,'cancelled':0,'skipped':0,'todo':0}
assert run['actor']==ACTOR and run['role']=='acceptance' and run['commit']==HEAD and not run['working_tree_dirty'] and run['exit_code']==0
assert run['validation']['ok'] and run['validation']['testSummary']==summary
for output in run['outputs']:assert sha(BASE/output['path'])==output['sha256']
observer=read(BASE/run['node_observer']['summary']['path']);assert observer['success'] and observer['tests']==39 and observer['passed']==39
for name in ['independent-acceptance','independent-gate','independent-c1-target','independent-handoff','independent-gate-after-handoff']:
 execution=read(BASE/(name+'.run.json'));assert execution['source_commit']==HEAD and execution['actor']==ACTOR and execution['exit_code']==0
 for stream in ['stdout','stderr']:assert sha(BASE/execution[stream]['path'])==execution[stream]['sha256']
handoff=read(BASE/'handoff.json');assert handoff['repair_baseline']==HEAD==handoff['acceptance_baseline']
assert len(handoff['closed_problems'])==1 and not handoff['open_problems'] and handoff['environment_claim']=='local-preview'
assert handoff['closed_problems'][0]['verified_by']==ACTOR
c1=read(BASE/'independent-c1-vitest.json');assert c1['success'] and (c1['numTotalTests'],c1['numPassedTests'],c1['numFailedTests'],c1['numPendingTests'])==(31,1,0,30)
passed=[r for f in c1['testResults'] for r in f['assertionResults'] if r['status']=='passed'];assert len(passed)==1
current_cases=[copy.deepcopy(r) for r in read(historical/'independent-test-cases.json')['cases'] if r['suite']=='MC023 official native contract']
tap=(BASE/run['outputs'][0]['path']).read_text()
assert [r['name'] for r in current_cases]==re.findall(r'^# Subtest: (.+)$',tap,re.M)
for row in current_cases:row['execution']=runref;row['actual']='pass; actual current98739/39 official Node assertion, zero skip/cancel/todo'
current_cases.append({'suite':'C1 precise changed integration target','name':passed[0]['fullName'],'source':'packages/video-studio/src/vendor-compat.test.ts:951',
 'preconditions':'Actual VideoStudio.runPreproduction, native PRDGenerator/ScriptEngine/confirmation interfaces; offline Phase3 data and model-response fixtures.',
 'steps':'Run success instance; assert Phase3 and8 instance contract wrappers installed at create; run budget-rejected second instance; assert events and restoration after both.',
 'expected':'Success Phase3 passed; failure PHASE3_BUDGET_EXHAUSTED; every instance wrapper restored and shared Phase3 prototype/reference removed.',
 'actual':'pass;1passed/30filtered pending/0failed in31 definitions; no real provider calls; no production PRD approval claim.','grade':'B',
 'execution':ref(BASE/'independent-c1-target.run.json')})
write(BASE/'independent-test-cases.json',{'schema':'workloom.independent-test-cases/v1','source_commit':HEAD,'definition_count':40,'cases':current_cases,
 'filtered_cases':[{'name':r['fullName'],'actual':'pending because -t excludes this target; not executed'} for f in c1['testResults'] for r in f['assertionResults'] if r['status']=='pending']})
history={'schema':'workloom.independent-attempt-history/v1','source_commit':HEAD,'history':[
 {'grade':'B','kind':'Immutable19 prior acceptance and preserved failures','source_commit':OLD,
  'evidence':ref(historical/'independent-attempt-history.json'),'actual':'Prior39/16/11/91 plus first failed independent fixture and helper failures remain exact source-bound history.'},
 {'grade':'B','kind':'Current repair run','source_commit':HEAD,'actor':card['fixed_by'],'evidence':{'path':'runs/MC-023-0-1791228796510.json','sha256':sha(BASE/'runs/MC-023-0-1791228796510.json')},
  'actual':'Current39/39 repair green copied as repair-role evidence; separate from independent39 and not counted twice.'},
 {'grade':'B','kind':'Current independent run','source_commit':HEAD,'evidence':runref,'actual':'Current39/39 official independent run0.'},
 {'grade':'B','kind':'Relaunch guard rejection','evidence':ref(BASE/'environment/relaunch-guard-rejection.json'),
  'actual':'Helper refused existing completed evidence directory before running tests; preserved successful run and verified contents.'}]}
write(BASE/'independent-attempt-history.json',history)
oldreceipt=read(historical/'independent-acceptance-receipt.json')
inherited={'source_commit':OLD,'not_current_execution':True,'required_condition':'All production source bytes unchanged by complete5322 tracked-byte comparison.',
 'source_equality':ref(BASE/'source-byte-rebinding.json'),'receipt':ref(historical/'independent-acceptance-receipt.json'),
 'formal39':39,'requirement_regression16':16,'independent_boundaries11':11,'affected_vitest91':91,
 'types_builds':oldreceipt['counts']['interpretation'],
 'report':ref(historical/'independent-acceptance-report.json'),'manifest':ref(historical/'independent-archive-manifest.json')}
findings=[
 {'grade':'A','claim':'Changed C1 fixture now instantiates actual native PRDGenerator, ScriptEngine and original confirmation method; it checks8 per-instance wrappers installed and restored around success and budget failure.','source':'packages/video-studio/src/vendor-compat.test.ts:951-1015'},
 {'grade':'B','claim':'Only vendor-compat.test.ts differs across current987 and sealed19 tracked source/archive set; production source bytes are unchanged.','evidence':'source-byte-rebinding.json'},
 {'grade':'B','claim':'Current official39/39 source-authority assertions plus C1 exact1/1 passed; gate/handoff/postgate all actual0.30 filtered C1 definitions do not contribute coverage.','evidence':'independent-test-cases.json'},
 {'grade':'C','claim':'Scoped compatibility source retains shared Phase3 installation through the historical entry and cleanup; whole2053-line compatibility file remains targeted coverage.','source':'packages/video-studio/src/vendor-compat.ts:770-790/1754-2053'},
 {'grade':'D','claim':'No current production G4 score, visual approval, real portrait execution, complete film or release result is claimed. Current source-contract green is local-preview only.'}]
closure={'completed':['Current exact987 source rebind and full5322 tracked bytes.','Current MC02339/39 plus C1 selected1/1.','Actual original-directory gate/handoff/postgate0.','Immutable19 receipt/history preserved and new current source-bound seal.'],
 'not_covered':['30 filtered C1 definitions; unrelated broad suites/old22 not re-executed.','Original live models/visuals/media/services/PG/runtime/release belong to coordinator, outside acceptance authorization.'],
 'autonomous_additions':['Existing-directory guard rejection preserved without overwriting successful evidence.','Prior complete bundle copied as exact-byte historical provenance so old inherited checks retain their own SHA.'],
 'assumptions':['Only test fixture changed, so old production evidence remains attached to19 and is supported by exact current source byte equality; it is not relabeled987 execution.'],
 'confidence':'High for explicitly executed local contracts and byte/actor/baseline integrity; no inference about current production quality.',
 'recommended_review':['Actual current run and original observer destination.','C1 full fixture and30filtered list.','Source equality and inherited19source/receipt boundaries.']}
selfcheck=[{'question':q,'answer':'yes'} for q in ['Covered entire authorized MC023 rebind and C1 target scope, with excluded scope declared.','Completed autonomous necessary work without unnecessary user questions.','Claims and code references have accurate A/B/C/D evidence grades.','Source-bound raw evidence and exclusions withstand detailed engineering review.']]
report={'schema':'workloom.independent-acceptance-report/v1','source_commit':HEAD,'previous_commit':OLD,'actor':ACTOR,'role':'acceptance','generated_at':NOW,
 'status':'MC023-rebound-current987-verified-local-preview','coverage':ref(BASE/'independent-source-coverage.json'),
 'official_run':runref,'official_summary':summary,'current_test_counts':{'official39':39,'c1_selected':1,'total_executed_definitions':40,'c1_filtered_pending':30},
 'inherited19_only':inherited,'handoff':ref(BASE/'handoff.json'),'findings':findings,'attempt_history':ref(BASE/'independent-attempt-history.json'),
 'case_details':ref(BASE/'independent-test-cases.json'),'closure':closure,'selfcheck':selfcheck,'environment_claim':'local-preview',
 'production_claim':False,'product_source_modified_by_acceptance':False,'old19_evidence_modified':False}
write(BASE/'independent-acceptance-report.json',report)
receipt={'schema':'workloom.independent-acceptance-receipt/v1','task_id':'T-2026-1006-0001','card':'MC-023','source_commit':HEAD,'previous_commit':OLD,
 'actor':ACTOR,'role':'acceptance','repair_actor':card['fixed_by'],'status':'verified-local-preview','generated_at':NOW,
 'repair_baseline':HEAD,'acceptance_baseline':HEAD,'official_run':runref,'official_summary':summary,
 'acceptance_execution':ref(BASE/'independent-acceptance.run.json'),'gate_execution':ref(BASE/'independent-gate.run.json'),
 'c1_target_execution':ref(BASE/'independent-c1-target.run.json'),'handoff_execution':ref(BASE/'independent-handoff.run.json'),
 'post_handoff_gate':ref(BASE/'independent-gate-after-handoff.run.json'),'ledger':ref(BASE/'ledger.json'),'handoff':ref(BASE/'handoff.json'),
 'source_coverage':ref(BASE/'independent-source-coverage.json'),'source_rebinding':ref(BASE/'source-byte-rebinding.json'),
 'case_matrix':ref(BASE/'independent-test-cases.json'),'report':ref(BASE/'independent-acceptance-report.json'),
 'attempt_history':ref(BASE/'independent-attempt-history.json'),
 'counts':{'current_official':39,'current_c1_selected':1,'current_definition_total':40,'c1_filtered_not_executed':30},
 'inherited19_only':inherited,'environment_claim':'local-preview','production_claim':False,'read_only_product_source':True,
 'no_real_models_media_pg_services':True,'receipt_description':'Actor/source-bound SHA256 audit receipt, not a cryptographic signature or live production approval.'}
write(BASE/'independent-acceptance-receipt.json',receipt)
md='''## 覆盖率声明

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
'''
(BASE/'independent-acceptance-report.md').write_text(md)
clean()
manifest={'schema':'workloom.independent-bundle-manifest/v1','source_commit':HEAD,'actor':ACTOR,'generated_at':NOW,
 'self_exclusion':'independent-archive-manifest.json is excluded from its own hash census; external validation includes its byte hash.',
 'files':[{'path':p.relative_to(BASE).as_posix(),'sha256':sha(p),'bytes':p.stat().st_size} for p in sorted(BASE.rglob('*')) if p.is_file() and p.name!='independent-archive-manifest.json']}
# A nested old manifest is ordinary historical evidence and must be counted.
manifest['files']=[{'path':p.relative_to(BASE).as_posix(),'sha256':sha(p),'bytes':p.stat().st_size} for p in sorted(BASE.rglob('*')) if p.is_file() and p!=BASE/'independent-archive-manifest.json']
write(BASE/'independent-archive-manifest.json',manifest)
for target in [MIRROR,DELIVERABLE]:
 assert not target.exists(),target
 shutil.copytree(BASE,target)
 for row in manifest['files']:assert sha(target/row['path'])==row['sha256']
 assert sha(target/'independent-archive-manifest.json')==sha(BASE/'independent-archive-manifest.json')
clean()
validation={'schema':'workloom.independent-bundle-validation/v1','source_commit':HEAD,'result':'PASS','generated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
 'original_execution_directory':str(BASE),'byte_identical_archives':[str(MIRROR),str(DELIVERABLE)],'all_files_plus_self':len(manifest['files'])+1,
 'manifest_sha256':sha(BASE/'independent-archive-manifest.json'),'receipt_sha256':sha(BASE/'independent-acceptance-receipt.json'),
 'report_sha256':sha(BASE/'independent-acceptance-report.json'),'all_source_files_still_clean':True,
 'original_observer_path_preserved':run['node_observer']['destination'],'current39_plus1':True,'filtered30_not_covered':True,
 'previous19_bundle_immutable_hash':sha(PREVIOUS/'independent-archive-manifest.json'),'previous19_all_files_equal':True}
write(CHAT/'outputs/native-prd-independent-9877680-validation.json',validation)
print(json.dumps(validation,ensure_ascii=False,indent=2))
