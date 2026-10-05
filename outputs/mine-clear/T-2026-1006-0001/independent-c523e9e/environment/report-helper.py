"""Current c523 narrow acceptance seal, exact-tree grade carry, no historical rewrites."""
import collections,copy,datetime,hashlib,json,pathlib,re,shutil,subprocess
CHAT=pathlib.Path(__file__).resolve().parent.parent
ROOT=CHAT/'work/growth-native-acceptance-9c69b8c'
HEAD='c523e9e24300755a6f65c018712ad85c1005838d';OLD='98776805f108105a6f5891f1bb3f700331848c78'
ORIGINAL='19fff17247c075a2bb6c2bbcd8016db42643f682';TREE='5f0c0de7273f73213bd2e6b0a675e18d6bc0d95d'
ACTOR='native-entry-independent-acceptance'
BASE=ROOT/'outputs/mine-clear/T-2026-1006-0001/independent-c523e9e'
PREVIOUS=CHAT/'outputs/native-prd-independent-9877680'
MIRROR=CHAT/'outputs/mine-clear/T-2026-1006-0001/independent-c523e9e'
DELIVERABLE=CHAT/'outputs/native-prd-independent-c523e9e'
NOW=datetime.datetime.now(datetime.timezone.utc).isoformat()
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text())
def write(p,v):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def ref(p):return {'path':p.relative_to(BASE).as_posix(),'sha256':sha(p)}
def git(*args):return subprocess.check_output(['git',*args],cwd=ROOT)
def clean():
 assert git('rev-parse','HEAD').decode().strip()==HEAD and not git('status','--porcelain')
def hash_refs(v):
 if isinstance(v,dict):
  for key in ['path','ref']:
   if isinstance(v.get(key),str) and isinstance(v.get('sha256'),str):yield v[key],v['sha256']
  for x in v.values():yield from hash_refs(x)
 elif isinstance(v,list):
  for x in v:yield from hash_refs(x)
clean();assert not (BASE/'independent-acceptance-receipt.json').exists(),'Seal once'
assert git('rev-parse',HEAD+'^{tree}').decode().strip()==TREE==git('rev-parse',OLD+'^{tree}').decode().strip()
assert not git('diff','--name-only',OLD,HEAD)
rebinding=read(BASE/'source-byte-rebinding.json');assert rebinding['source_commit']==HEAD and rebinding['previous_commit']==OLD
assert rebinding['complete_tracked_files']==5322 and rebinding['changed_files']==[] and rebinding['whole_tree_identity']==TREE
assert len(rebinding['trackedFiles'])==len([p for p in git('ls-files','-z').split(b'\0') if p])==5322
for row in rebinding['trackedFiles']:
 p=ROOT/row['path'];digest=hashlib.sha256(str(p.readlink()).encode()).hexdigest() if p.is_symlink() else sha(p)
 assert digest==row['sha256'] and row['same_as9877680']
oldmanifest=read(PREVIOUS/'independent-archive-manifest.json')
assert sha(PREVIOUS/'independent-archive-manifest.json')=='d039c9d09459304ca4511db380f15ee9d53495706946f7dc3d62264635d2421a'
for row in oldmanifest['files']:assert sha(PREVIOUS/row['path'])==row['sha256']
ledger=read(BASE/'ledger.json');assert ledger['baseline']['repair']['commit']==HEAD==ledger['baseline']['acceptance']['commit']
assert len(ledger['cards'])==1
card=ledger['cards'][0];assert card['id']=='MC-023' and card['state']=='verified' and card['verified_by']==ACTOR and card['fixed_by']!=ACTOR
runref=card['assertions'][0]['run'];official=read(BASE/runref['path']);assert sha(BASE/runref['path'])==runref['sha256']
summary={'total':39,'passed':39,'failed':0,'cancelled':0,'skipped':0,'todo':0}
assert official['commit']==HEAD and official['actor']==ACTOR and official['role']=='acceptance' and official['exit_code']==0 and not official['working_tree_dirty']
assert official['validation']['ok'] and official['validation']['testSummary']==summary
for row in official['outputs']:assert sha(BASE/row['path'])==row['sha256']
assert pathlib.Path(official['node_observer']['destination'])==BASE/official['node_observer']['summary']['path']
repair_path=BASE/'runs/MC-023-0-1791229593448.json';repair=read(repair_path)
assert sha(repair_path)=='1ef50a26b818e9f7237cfabd7c443603158a6764a8959d82f9bcf6ced852a7ad'
assert repair['actor']==card['fixed_by'] and repair['role']=='repair' and repair['commit']==HEAD and repair['exit_code']==0
assert repair['validation']['testSummary']==summary
for row in repair['outputs']:assert sha(BASE/row['path'])==row['sha256']
for name in ['independent-acceptance','independent-gate','independent-c1-target-retry','independent-handoff','independent-gate-after-handoff']:
 x=read(BASE/(name+'.run.json'));assert x['source_commit']==HEAD and x['actor']==ACTOR and x['exit_code']==0
 for stream in ['stdout','stderr']:assert sha(BASE/x[stream]['path'])==x[stream]['sha256']
first=read(BASE/'independent-c1-target.run.json');assert first['source_commit']==HEAD and first['exit_code']==1
for stream in ['stdout','stderr']:assert sha(BASE/first[stream]['path'])==first[stream]['sha256']
first_json=read(BASE/'independent-c1-vitest.json');assert not first_json['success'] and first_json['numPassedTests']==1 and first_json['numFailedTests']==0
assert len(first_json['testResults'])==2
c1=read(BASE/'independent-c1-vitest-retry.json');assert c1['success'] and len(c1['testResults'])==1
assert (c1['numTotalTests'],c1['numPassedTests'],c1['numFailedTests'],c1['numPendingTests'],c1['numTodoTests'])==(31,1,0,30,0)
passed=[r for f in c1['testResults'] for r in f['assertionResults'] if r['status']=='passed']
filtered=[r for f in c1['testResults'] for r in f['assertionResults'] if r['status']=='skipped']
assert len(passed)==1 and len(filtered)==30
handoff=read(BASE/'handoff.json');assert handoff['repair_baseline']==HEAD==handoff['acceptance_baseline']
assert handoff['environment_claim']=='local-preview' and len(handoff['closed_problems'])==1 and not handoff['open_problems']
assert handoff['closed_problems'][0]['verified_by']==ACTOR and handoff['closed_problems'][0]['verification_evidence']==runref
historical=BASE/'historical/independent-9877680'
shutil.copytree(PREVIOUS,historical)
for row in oldmanifest['files']:assert sha(historical/row['path'])==row['sha256']
assert sha(historical/'independent-archive-manifest.json')==sha(PREVIOUS/'independent-archive-manifest.json')
oldqa=BASE/'historical/independent-9877680-postseal-qa.json';shutil.copyfile(CHAT/'outputs/native-prd-independent-9877680-postseal-qa.json',oldqa)
assert sha(oldqa)=='70051737dab75d398ad798e7410d2db99d2539c06d1e27f2d82d5f14644f1261'
for source,target in [
 (CHAT/'work/native-mc023-c523-execution.py',BASE/'environment/execution-helper.py'),
 (CHAT/'work/native-mc023-c523-retry.py',BASE/'environment/c1-retry-helper.py'),
 (pathlib.Path(__file__),BASE/'environment/report-helper.py')]:
 target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,target)
write(BASE/'environment/vitest-filter-source.json',{'grade':'B','checked_at':NOW,'official_source':'https://main.vitest.dev/guide/cli.html',
 'support':'CLI filename filter checks path inclusion; --exclude adds file globs.',
 'official_exclude_source':'https://main.vitest.dev/config/exclude',
 'actual_retry_flags':['--exclude','**/dist-payload/**','--exclude','**/outputs/**'],
 'purpose':'Exclude immutable report copies from runner discovery without changing source/tests or the selected C1 -t target.'})
oldcoverage=read(historical/'independent-source-coverage.json');rows=[]
for row in oldcoverage['files']:
 q=copy.deepcopy(row);assert sha(ROOT/q['file'])==q['sha256'] and git('show',HEAD+':'+q['file'])==(ROOT/q['file']).read_bytes()
 q.update(source_commit=HEAD,carried_from_commit=OLD,exact_bytes_unchanged=True,current_reuse_comparison_grade='B',
  provenance_inventory='historical/independent-9877680/independent-source-coverage.json',
  method='Earlier semantic A/C grade carried only after entire Git tree and5322 tracked bytes/whole file equality. Current comparison is B, with no new full semantic reading claim.')
 rows.append(q)
grades=collections.Counter(r['grade'] for r in rows);assert len(rows)==61 and grades=={'A':58,'C':3}
coverage={'schema':'workloom.independent-source-coverage/v1','source_commit':HEAD,
 'scope':'Explicit c523 same-tree metadata rebind of MC023 and selected C1 target, source scope inherited only after whole equality',
 'counts':{'total':61,**{g:grades[g] for g in ['A','B','C','D']}},'new_complete_reads':0,'carried_complete_reads':58,
 'current_comparison_grade':'B','changed_files':[],'files':sorted(rows,key=lambda r:r['file']),
 'partial_and_unread_list':[r for r in rows if r['grade']!='A'],
 'complete_tracked_copy_identity':{'grade':'B','files':5322,'reference':'source-byte-rebinding.json','tree_identity':TREE,
  'meaning':'5322 exact bytes compared; overlaps the61-file semantic scope and is not a full semantic audit.'},
 'grade_definitions':oldcoverage['grade_definitions'],'exclusions':oldcoverage['exclusions']}
write(BASE/'independent-source-coverage.json',coverage)
cases=[copy.deepcopy(r) for r in read(historical/'independent-test-cases.json')['cases'] if r['suite']=='MC023 official native contract']
tap=(BASE/official['outputs'][0]['path']).read_text();assert len(cases)==39 and [r['name'] for r in cases]==re.findall(r'^# Subtest: (.+)$',tap,re.M)
for row in cases:row['execution']=runref;row['actual']='pass; actual currentc52339/39 official Node assertions, no skipped/cancelled/todo'
cases.append({'suite':'C1 precise installation target','name':passed[0]['fullName'],'source':'packages/video-studio/src/vendor-compat.test.ts:951',
 'preconditions':'Actual VideoStudio.runPreproduction and native PRDGenerator/ScriptEngine/confirmation methods; offline Phase3 response fixtures; archived outputs excluded from discovery.',
 'steps':'Run success; check8 instance contract wrappers plus shared Phase3 at create; run budget-rejected second instance; inspect events and every wrapper restoration.',
 'expected':'Success Phase3 passed; failure PHASE3_BUDGET_EXHAUSTED;8 per-instance methods restored and shared prototype/ref removed after both instances.',
 'actual':'pass; retry command0;1passed/30filteredskipped in31, actual source file only. Initial command1 collected archival source copy; initial real C1 itself passed.',
 'grade':'B','execution':ref(BASE/'independent-c1-target-retry.run.json')})
matrix={'schema':'workloom.independent-test-cases/v1','source_commit':HEAD,'definition_count':40,'execution_instances':41,
 'execution_count_reason':'39 official + C1 target twice. Initial C1 target passed but whole command failed archival suite collection; final target retry0.',
 'cases':cases,'filtered_cases':[{'name':r['fullName'],'status':r['status'],'actual':'Not executed because exact C1 -t target filter; not counted as coverage.'} for r in filtered]}
assert len(matrix['cases'])==40 and len(matrix['filtered_cases'])==30
write(BASE/'independent-test-cases.json',matrix)
source19=historical/'historical/independent-19fff17'
assert sha(source19/'independent-archive-manifest.json')=='d179e546fe44b126a4f28d6925a67943607724a538c0bf6c261345d6d18a6019'
inherited={'source_commit':ORIGINAL,'not_current_execution':True,'source_equality_chain':'Currentc523 entiretree/5322byteequal987;987 onlyvendor-compat.test.ts differs from19.',
 'current_equality':ref(BASE/'source-byte-rebinding.json'),'prior_equality':ref(historical/'source-byte-rebinding.json'),
 'receipt':ref(source19/'independent-acceptance-receipt.json'),'report':ref(source19/'independent-acceptance-report.json'),
 'typechecks':ref(source19/'independent-typechecks.json'),'manifest':ref(source19/'independent-archive-manifest.json'),
 'definition_counts':{'old_official39':39,'requirement_regression':16,'independent_boundaries':11,'affected_vitest':91}}
history={'schema':'workloom.independent-attempt-history/v1','source_commit':HEAD,'history':[
 {'grade':'B','kind':'Immutable987 history plus explicit filtered-list metadata correction','source_commit':OLD,
  'evidence':[ref(historical/'independent-attempt-history.json'),ref(oldqa)],'actual':'Prior official40 and all19 historical raw failures remain source-bound; original987 list omission kept with explicit external30-name supplement.'},
 {'grade':'B','kind':'Current separate repair-role39 green','source_commit':HEAD,'actor':repair['actor'],'evidence':ref(repair_path),'actual':'39/39 actual0; not counted a second time as independent tests.'},
 {'grade':'B','kind':'Current independent official39 green','source_commit':HEAD,'actor':ACTOR,'evidence':runref,'actual':'39/39 actual0.'},
 {'grade':'B','kind':'Current first C1 archival collection failure','source_commit':HEAD,'evidence':[ref(BASE/'independent-c1-target.run.json'),ref(BASE/'independent-c1-vitest.json')],
  'actual':'Whole commandexit1; actual real C1 target1passed,30skipped; immutable987 reviewed-source copy also discovered and failed collection due missing duration-projection.js. No product regression asserted.'},
 {'grade':'B','kind':'Current C1 scoped retry','source_commit':HEAD,'evidence':[ref(BASE/'independent-c1-target-retry.run.json'),ref(BASE/'independent-c1-vitest-retry.json')],
  'actual':'Added outputs exclude at runner command only;1actualsourcefile/1passed/30filtered, whole command0.'}]}
write(BASE/'independent-attempt-history.json',history)
findings=[
 {'grade':'B','claim':'Current source tree and5322 tracked bytes equal987 exactly; semantic58A/3C grades are inherited with B current byte reuse, not new full reads.','evidence':'source-byte-rebinding.json'},
 {'grade':'B','claim':'Fresh current MC02339/39 and C1 target1/1 passed; current40 definitions;41 executioninstances include initial real C1 success inside failed archive collection command.','evidence':'independent-test-cases.json'},
 {'grade':'B','claim':'Current acceptance and repair actors distinct, both baselinec523; original-directory gate/handoff/postgate0 with1closed0open local-preview.','evidence':'handoff.json'},
 {'grade':'A','provenance':'Carried from full987 fixture read after exact current byte comparison B.','claim':'C1 fixture checks8 real native instance method wrappers installed and restored around successful and budget-failed runPreproduction.','source':'packages/video-studio/src/vendor-compat.test.ts:951-1015'},
 {'grade':'C','provenance':'Carried targeted regions, whole source hash equal.','claim':'Actual historical compatibility entry delegates shared Phase3 bridge and listed implementation cleanup; other compatibility regions remain unaudited.','source':'packages/video-studio/src/vendor-compat.ts:770-790/1754-2053'},
 {'grade':'D','claim':'No current live G4 model/visual quality/real portrait/30second film/production/release acceptance is inferred from local-preview contracts.'}]
closure={'completed':['Currentc523 entiretree/5322byte rebind.','Fresh official39 and preciseC1 target1, original-dir gates/handoff.','Current40 complete conditions/steps/expected/actual rows plus30filterednames.','Immutable987 and19 historical raw bundles and current C1 command failure/retry preserved.','Source-bound audit receipt and triple exact-byte seal.'],
 'not_covered':['C1 other30 and old16/11/91/types/22wide not re-executed.','Live providers/models/visuals/media/PG/service/runtime/film/release are coordinator authorization, outside this role.'],
 'autonomous_additions':['Excluded output archives from test discovery after actual archival collection failure; necessary to exercise only original target source.','Preserved initial failed command and prior987 external filtered-name correction as history.'],
 'assumptions':['Exact same production bytes support carrying older read grades and19 checks with original SHA; current B byte reuse is not fresh semantic reading or relabeled test execution.'],
 'confidence':'High for declared current local contracts/metadata/roles/baselines; no current production-quality claim.',
 'recommended_review':['Current original observer/run and distinct actors.','C1 first commandfailure vs final retry plus30filterednames.','Current5322same-tree proof and inherited19 check boundaries.']}
selfcheck=[{'question':q,'answer':'yes'} for q in ['Covered all authorized current MC023/C1 rebind scope, with exclusions explicit.','Completed autonomous work without asking unnecessary questions.','Each conclusion has accurate grade and source/raw evidence.','Source-bound evidence, preserved failures and limits support detailed engineering review.']]
report={'schema':'workloom.independent-acceptance-report/v1','source_commit':HEAD,'previous_commit':OLD,'tree':TREE,'actor':ACTOR,'role':'acceptance',
 'generated_at':NOW,'status':'MC023-c523-verified-local-preview','coverage':ref(BASE/'independent-source-coverage.json'),
 'official_run':runref,'official_summary':summary,'test_counts':{'current_definitions':40,'current_execution_instances':41,'filtered_c1_not_run':30},
 'inherited19_only':inherited,'handoff':ref(BASE/'handoff.json'),'findings':findings,'attempt_history':ref(BASE/'independent-attempt-history.json'),
 'case_details':ref(BASE/'independent-test-cases.json'),'closure':closure,'selfcheck':selfcheck,
 'environment_claim':'local-preview','production_claim':False,'product_source_modified_by_acceptance':False,'historical_seals_modified':False}
write(BASE/'independent-acceptance-report.json',report)
receipt={'schema':'workloom.independent-acceptance-receipt/v1','task_id':'T-2026-1006-0001','card':'MC-023','source_commit':HEAD,'previous_commit':OLD,
 'tree':TREE,'actor':ACTOR,'role':'acceptance','repair_actor':repair['actor'],'generated_at':NOW,'status':'verified-local-preview',
 'repair_baseline':HEAD,'acceptance_baseline':HEAD,'official_run':runref,'official_summary':summary,
 'acceptance_execution':ref(BASE/'independent-acceptance.run.json'),'gate_execution':ref(BASE/'independent-gate.run.json'),
 'c1_first_failed_command':ref(BASE/'independent-c1-target.run.json'),'c1_final_execution':ref(BASE/'independent-c1-target-retry.run.json'),
 'handoff_execution':ref(BASE/'independent-handoff.run.json'),'post_handoff_gate':ref(BASE/'independent-gate-after-handoff.run.json'),
 'ledger':ref(BASE/'ledger.json'),'handoff':ref(BASE/'handoff.json'),'source_coverage':ref(BASE/'independent-source-coverage.json'),
 'source_rebinding':ref(BASE/'source-byte-rebinding.json'),'case_matrix':ref(BASE/'independent-test-cases.json'),
 'report':ref(BASE/'independent-acceptance-report.json'),'attempt_history':ref(BASE/'independent-attempt-history.json'),
 'counts':{'current_official':39,'current_c1_selected':1,'current_definition_total':40,'execution_instances_including_c1_initial':41,'c1_filtered_not_executed':30},
 'inherited19_only':inherited,'environment_claim':'local-preview','production_claim':False,'read_only_product_source':True,
 'no_real_models_media_pg_services':True,'receipt_description':'Actor/source-bound SHA256 audit receipt; not a cryptographic signature or current live production approval.'}
write(BASE/'independent-acceptance-receipt.json',receipt)
md='''## 覆盖率声明

- 范围内文件总数：61；精读：58（全部为旧语义精读，经当前相同tree与整文件字节比对继承）；机检/脚本解析：0；抽样：3；未读：0。
- 本轮没有新全量语义阅读。当前重用检查证据为 **B**：完整5322个跟踪文件SHA、Git tree相等、61范围内整文件SHA均复核；5322机检与语义范围重叠，不代表5322精读。
- 抽样清单及原因：vendor index.js 4126行的PRD/G4/Script/Portrait段；full-chain-film.mts 8176行字幕段；vendor-compat.ts 2053行实际入口/共享桥/Phase3段。准确行区间与不读部分理由在 independent-source-coverage.json。

当前 **c523e9e24300755a6f65c018712ad85c1005838d** 的 MC-023 本机预览结构验收通过。正式独立39/39、C1精准目标1/1，gate/handoff/postgate均实际exit0；交接闭合1、未闭合0，修复与独立验收actor不同。本次40是测试定义数；41执行实例包含C1两次，第一次目标通过但整命令因归档副本收集失败exit1。

| 项目 | 当前实际结果 | 证据 |
|---|---|---|
| MC-023原生五Agent→Markdown/G4→Script/Portrait合同 | 39/39，0失败/跳过/取消/todo | B，原始run/observer/TAP |
| C1实际runPreproduction安装入口 | 最终1通过；其他30按-t过滤未执行 | B，retry原始输出和31条Vitest JSON |
| gate/handoff/postgate | 0/0/0，local-preview | B，原目录真实执行回执 |
| c523对987完整跟踪字节 | 5322完全相同；Git tree相同5f0c0de7273f73213bd2e6b0a675e18d6bc0d95d | B，source-byte-rebinding.json |
| 19fff17旧16/11/91和构建/类型检查 | 保留原SHA历史，本次未重跑 | B，嵌套历史封存及source相等链 |

A（旧读继承，当前比较B）：C1 fixture使用真实PRDGenerator、ScriptEngine与原始确认方法，检查8个实例方法在create时安装；成功和预算拒绝两轮结束后检查原方法恢复。C（旧段继承）：兼容入口与共享Phase3实现的指定行区间建立调用/清理关系，2053行其余部分未重新全读。B：当前39+1断言与三基线、actor和门禁均有完整原始输出。D：不作当前真实模型G4得分、脸/视觉质量、真实画像、完整成片或发布结论。

首次C1命令实际原目标1通过，但还收集了旧987封存 reviewed-source 中同名测试。该归档缺duration-projection.js，命令整体exit1；首次stdout/stderr/JSON完整保留。只在当前runner添加 **/outputs/** 排除归档，再跑相同精准目标得到1源文件、1通过、30过滤、exit0，未改产品或测试。Vitest文件过滤是路径包含匹配，CLI排除glob可以追加，见[官方CLI](https://main.vitest.dev/guide/cli.html)及[官方exclude说明](https://main.vitest.dev/config/exclude)。

本次case matrix完整列出40行前置条件、步骤、预期、实际和全部30条过滤名称。旧987便利filtered列表遗漏的原字节保持不变，其外部QA勘误与30名称完整复制进当前历史目录。原VID1014 G4 Markdown、e0历史30总/5通过/25失败、19独立fixture首失败与修正均保持原字节，不包装成当前生产结果。

C1使用离线Phase3输入与响应替身，不执行真实需求发现、PRD创作或provider；官方39执行原生五Agent/parser/adapter和受控响应、照片字节fixture。合同fixture属于结构证据，不是视觉或真实审批凭证。当前新SHA与987整树完全一致，代码精读和生产源证据仅按准确SHA和B字节证明继承。本角色未改vendor/产品源码、未放宽评分、未手写创意替代原PRD，未调用模型/媒体/数据库/服务。

实际执行目录为 work/growth-native-acceptance-9c69b8c/outputs/mine-clear/T-2026-1006-0001/independent-c523e9e。所有归档保持原observer绝对路径，不能冒充在迁移目录重跑gate。receipt是actor/source绑定SHA256审计回执，并非密码学签名。报告环境只允许写local-preview，本次不宣称生产实测或发布通过。

## 收尾报告

- 已完成：精确c523普通checkout与完整5322相同tree/字节验证；39正式独立断言、C1精准1目标、gate/handoff/postgate；40完整用例加30过滤列表；首C1命令失败与retry原始证据；当前独立actor回执与新SHA封存及副本哈希复核。
- 未完成/未覆盖：其余C1 30、旧16/11/91/types/22未重复执行；全provider/render/runtime、真实模型/视觉/媒体/PG/服务/成片/发布属于协调者范围，不计本角色验收。
- 自主追加事项及理由：实际发现归档同名测试被收集后为runner增加outputs排除，确保只加载真实源目标；保留整命令首失败及旧987元数据勘误，避免用最终绿色抹去历史。
- 采用的假设：全部tree/5322文件字节相等支持继承旧语义A/C和19生产源相关检查；当前B比较不等于新语义精读或把旧执行改标新SHA。
- 置信度：高，范围内真实断言、三基线、actor、字节和完整原始失败都可核算；对当前真实生产品质没有推断。
- 建议复核：官方run/observer绝对路径与不同actor；C1首次收集失败和retry及30过滤列表；5322相同tree与旧19证据边界。

## 自检表

- [是] 覆盖了授权任务全部范围，未挑容易部分；未覆盖范围明确。
- [是] 可自主工作已完成，没有不必要问句收尾。
- [是] 每条结论有可验证依据，A/B/C/D和旧读/旧执行标注明确。
- [是] 经得起资深工程师逐行审查，历史失败和当前边界完整留痕。
'''
(BASE/'independent-acceptance-report.md').write_text(md)
clean()
# Validate all current report refs before creating the immutable hash census.
for p in [BASE/'independent-acceptance-receipt.json',BASE/'independent-acceptance-report.json',BASE/'independent-attempt-history.json']:
 for name,digest in hash_refs(read(p)):
  q=pathlib.Path(name)
  if not q.is_absolute() and '..' not in q.parts:
   assert (BASE/q).is_file() and sha(BASE/q)==digest,(p,name)
manifest={'schema':'workloom.independent-archive-manifest/v1','source_commit':HEAD,'actor':ACTOR,'created_at':NOW,
 'self_excluded':'independent-archive-manifest.json','explanation':'Own self excluded; historical nested manifests included; external validation records current manifest hash.',
 'files':[{'path':p.relative_to(BASE).as_posix(),'sha256':sha(p),'bytes':p.stat().st_size} for p in sorted(BASE.rglob('*')) if p.is_file() and p!=BASE/'independent-archive-manifest.json']}
manifest['file_count']=len(manifest['files']);write(BASE/'independent-archive-manifest.json',manifest)
for target in [MIRROR,DELIVERABLE]:
 assert not target.exists(),target
 shutil.copytree(BASE,target)
 for row in manifest['files']:assert sha(target/row['path'])==row['sha256']
 assert sha(target/'independent-archive-manifest.json')==sha(BASE/'independent-archive-manifest.json')
clean()
validation={'schema':'workloom.independent-bundle-validation/v1','source_commit':HEAD,'tree':TREE,'result':'PASS',
 'generated_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'original_execution_directory':str(BASE),
 'byte_identical_archives':[str(MIRROR),str(DELIVERABLE)],'all_files_plus_self':manifest['file_count']+1,
 'manifest_sha256':sha(BASE/'independent-archive-manifest.json'),'receipt_sha256':sha(BASE/'independent-acceptance-receipt.json'),
 'report_sha256':sha(BASE/'independent-acceptance-report.json'),'current_cases':40,'execution_instances':41,'filtered_case_names':30,
 'first_c1_failed_command_preserved':True,'previous987_manifest':sha(PREVIOUS/'independent-archive-manifest.json'),
 'previous19_manifest':sha(source19/'independent-archive-manifest.json'),'all_source_files_still_clean':True,
 'original_observer_path_preserved':official['node_observer']['destination'],'source_coverage':coverage['counts'],
 'current_source_reuse_grade':'B','production_claim':False}
write(CHAT/'outputs/native-prd-independent-c523e9e-validation.json',validation)
print(json.dumps(validation,ensure_ascii=False,indent=2))
