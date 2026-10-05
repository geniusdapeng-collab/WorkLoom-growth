"""Only MC023 official rebinding and the changed C1 target at immutable987."""
import datetime,hashlib,json,os,pathlib,shutil,subprocess
CHAT=pathlib.Path(__file__).resolve().parent.parent
ROOT=CHAT/'work/growth-native-acceptance-9c69b8c';PARENT=CHAT/'work/growth-native-pipeline'
HEAD='98776805f108105a6f5891f1bb3f700331848c78';OLD='19fff17247c075a2bb6c2bbcd8016db42643f682';ACTOR='native-entry-independent-acceptance'
REL=pathlib.Path('outputs/mine-clear/T-2026-1006-0001/independent-9877680');BASE=ROOT/REL
SOURCE=CHAT/'outputs/mine-clear/T-2026-1006-0001/repair-9877680'
NODEDIR='/Users/mac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin';NODE=NODEDIR+'/node'
ENV={'HOME':os.environ['HOME'],'PATH':NODEDIR+':/usr/bin:/bin:/usr/sbin:/sbin','WORKLOOM_ASSERTION_MODULE_ROOT':str(ROOT),
 'NATIVE_ACCEPTANCE_REPO_ROOT':str(ROOT),'NATIVE_PRD_SOURCE_ROOT':str(ROOT),'WL_FFMPEG':str(CHAT/'work/no-media-operation/ffmpeg-disabled'),'WL_FFPROBE':str(CHAT/'work/no-media-operation/ffprobe-disabled')}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text())
def write(p,v):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def git(repo,*args):return subprocess.check_output(['git',*args],cwd=repo)
def clean():
 assert git(ROOT,'rev-parse','HEAD').decode().strip()==HEAD and not git(ROOT,'status','--porcelain')
clean();assert git(PARENT,'rev-parse','HEAD').decode().strip()==HEAD and not git(PARENT,'status','--porcelain')
assert git(ROOT,'diff','--name-only',OLD,HEAD).decode().splitlines()==['packages/video-studio/src/vendor-compat.test.ts']
exclude=pathlib.Path(git(ROOT,'rev-parse','--git-path','info/exclude').decode().strip());rule='/'+REL.as_posix()+'/'
content=exclude.read_text()
if rule not in content.splitlines():exclude.write_text(content+('\n' if content and not content.endswith('\n') else '')+rule+'\n')
BASE.mkdir(parents=True,exist_ok=False)
oldprep=read(CHAT/'work/native-entry-prepare-19fff17.json');oldrows={r['path']:r for r in oldprep['trackedFiles']}
names=[os.fsdecode(p) for p in git(ROOT,'ls-files','-z').split(b'\0') if p];assert set(names)==set(oldrows)
rows=[];changed=[]
for name in names:
 p=ROOT/name;q=PARENT/name
 if p.is_symlink():
  assert q.is_symlink() and os.readlink(p)==os.readlink(q);digest=hashlib.sha256(os.readlink(p).encode()).hexdigest()
 else:assert p.is_file() and q.is_file();digest=sha(p);assert digest==sha(q)
 if digest!=oldrows[name]['sha256']:changed.append(name)
 rows.append({'path':name,'sha256':digest,'same_as19fff17':digest==oldrows[name]['sha256']})
assert changed==['packages/video-studio/src/vendor-compat.test.ts']
write(BASE/'source-byte-rebinding.json',{'schema':'workloom.independent-source-rebinding/v1','source_commit':HEAD,'previous_commit':OLD,'actor':ACTOR,
 'complete_tracked_files':len(rows),'changed_files':changed,'production_source_bytes_unchanged':True,'trackedFiles':rows,'grade':'B',
 'previous_complete_identity_sha256':sha(CHAT/'work/native-entry-prepare-19fff17.json'),'ignore_metadata_file':str(exclude),'generated_evidence_rule':rule,
 'dependency_roots_retained_without_reclone':oldprep['dependencyRoots'],'no_real_provider_media_pg_services':True})
for selected in ['node_modules/tsx/package.json','node_modules/typescript/bin/tsc','packages/video-studio/node_modules/vitest/vitest.mjs']:
 p=ROOT/selected;assert p.is_file() and ROOT in p.resolve().parents
def refs(v):
 if isinstance(v,dict):
  for key in ['path','ref']:
   if isinstance(v.get(key),str) and isinstance(v.get('sha256'),str):yield v[key],v['sha256']
  for x in v.values():yield from refs(x)
 elif isinstance(v,list):
  for x in v:yield from refs(x)
def copy_refs(v,seen):
 for name,digest in refs(v):
  p=pathlib.Path(name)
  if p.is_absolute() or '..' in p.parts or name in seen or p.name=='evidence-index.json':continue
  seen.add(name);src=SOURCE/p
  if not src.is_file():continue
  assert sha(src)==digest;dst=BASE/p;dst.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(src,dst)
  if p.suffix=='.json':
   try:copy_refs(read(dst),seen)
   except json.JSONDecodeError:pass
ledger=read(SOURCE/'ledger.json');assert ledger['baseline']['repair']['commit']==HEAD and [r['id'] for r in ledger['cards']]==['MC-023']
shutil.copyfile(SOURCE/'ledger.json',BASE/'ledger.json');copy_refs(ledger,set());assert not (BASE/'evidence-index.json').exists()
def run(name,argv):
 clean();started=datetime.datetime.now(datetime.timezone.utc).isoformat();r=subprocess.run(argv,cwd=ROOT,env=ENV,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 v={'schema':'workloom.independent-execution/v1','name':name,'source_commit':HEAD,'actor':ACTOR,'role':'acceptance','argv':argv,'cwd':str(ROOT),
  'started_at':started,'finished_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exit_code':r.returncode,'environment_values':ENV,
  'environment_claim':'local-preview','external_or_paid_provider':False,'media_creation_allowed':False}
 for label,raw in [('stdout',r.stdout),('stderr',r.stderr)]:p=BASE/(name+'.'+label+'.txt');p.write_bytes(raw);v[label]={'path':p.name,'sha256':sha(p)}
 write(BASE/(name+'.run.json'),v);clean();print(json.dumps({'name':name,'actual_exit_code':r.returncode,'stdout_tail':r.stdout.decode(errors='replace')[-900:],'stderr_tail':r.stderr.decode(errors='replace')[-300:]},ensure_ascii=False),flush=True)
 assert r.returncode==0,'Actual failure preserved; do not claim acceptance';return v
common=[NODE,'scripts/delivery/mine-clear.mjs']
run('independent-acceptance',common+['run-assertions','--ledger',str(BASE/'ledger.json'),'--card','MC-023','--actor',ACTOR,'--role','acceptance','--repo',str(ROOT)])
run('independent-gate',common+['gate','--ledger',str(BASE/'ledger.json'),'--repo',str(ROOT),'--json'])
title='runPreproduction 经现有兼容入口安装并消费 Phase3，失败与成功均卸载还原'
run('independent-c1-target',[NODE,'packages/video-studio/node_modules/vitest/vitest.mjs','run','packages/video-studio/src/vendor-compat.test.ts','-t',title,
 '--exclude','**/dist-payload/**','--testTimeout','120000','--reporter=default','--reporter=json','--outputFile='+str(BASE/'independent-c1-vitest.json')])
target=read(BASE/'independent-c1-vitest.json');assert target['success'] and target['numPassedTests']==1 and target['numFailedTests']==0
assert target['numTotalTests']==31 and target['numPendingTests']==30
run('independent-handoff',common+['handoff','--ledger',str(BASE/'ledger.json'),'--repo',str(ROOT),'--env','local-preview','--json'])
run('independent-gate-after-handoff',common+['gate','--ledger',str(BASE/'ledger.json'),'--repo',str(ROOT),'--json'])
handoff=read(BASE/'handoff.json');assert handoff['repair_baseline']==HEAD==handoff['acceptance_baseline'] and len(handoff['closed_problems'])==1 and not handoff['open_problems']
clean();print(json.dumps({'status':'current-formal39-and-target1-pass','source_commit':HEAD,'base':str(BASE),'old16_11_91_types_not_rerun':True},ensure_ascii=False),flush=True)
