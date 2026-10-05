"""Run only authorized clean MC023, its narrow regressions and actual local-preview handoff."""
import argparse,datetime,hashlib,json,os,pathlib,shutil,subprocess,re,concurrent.futures
parser=argparse.ArgumentParser()
parser.add_argument('source_commit')
parser.add_argument('--source-task-dir',type=pathlib.Path)
parser.add_argument('--root',type=pathlib.Path)
parser.add_argument('--resume',action='store_true')
args=parser.parse_args()
CHAT=pathlib.Path(__file__).resolve().parent.parent
ROOT=(args.root or CHAT/'work/growth-native-acceptance-9c69b8c').resolve()
SOURCE=(args.source_task_dir or CHAT/'outputs/mine-clear/T-2026-1006-0001').resolve()
HEAD=args.source_commit; ACTOR='native-entry-independent-acceptance'; CARD='MC-023'
assert re.fullmatch(r'[a-f0-9]{40}',HEAD)
assert ROOT==CHAT/'work/growth-native-acceptance-9c69b8c'
assert SOURCE.is_relative_to(CHAT)
BASE=ROOT/'outputs/mine-clear/T-2026-1006-0001'/('independent-'+HEAD[:7])
NODEDIR='/Users/mac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin'; NODE=NODEDIR+'/node'
ENV={'HOME':os.environ['HOME'],'PATH':NODEDIR+':/usr/bin:/bin:/usr/sbin:/sbin',
 'WORKLOOM_ASSERTION_MODULE_ROOT':str(ROOT),'NATIVE_ACCEPTANCE_REPO_ROOT':str(ROOT),'NATIVE_PRD_SOURCE_ROOT':str(ROOT),
 'WL_FFMPEG':str(CHAT/'work/no-media-operation/ffmpeg-disabled'),'WL_FFPROBE':str(CHAT/'work/no-media-operation/ffprobe-disabled')}
def sha(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path):return json.loads(path.read_text())
def write(path,value):path.write_text(json.dumps(value,indent=2,ensure_ascii=False)+'\n')
def git(*arguments):return subprocess.check_output(['git',*arguments],cwd=ROOT,text=True).strip()
def clean():
 assert git('rev-parse','HEAD')==HEAD
 assert git('status','--porcelain')==''
def references(value):
 if isinstance(value,dict):
  for key in ('path','ref'):
   if isinstance(value.get(key),str) and isinstance(value.get('sha256'),str):yield value[key],value['sha256']
  for child in value.values():yield from references(child)
 elif isinstance(value,list):
  for child in value:yield from references(child)
def copy_reachable(value,seen):
 for name,digest in references(value):
  path=pathlib.Path(name)
  if path.is_absolute() or '..' in path.parts or name in seen:continue
  seen.add(name)
  if path.name=='evidence-index.json':continue
  source=SOURCE/path
  if not source.is_file():continue
  assert sha(source)==digest,source
  dest=BASE/path;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,dest)
  if path.suffix=='.json':
   try:copy_reachable(read(dest),seen)
   except json.JSONDecodeError:pass
def run(name,arguments):
 previous=BASE/(name+'.run.json')
 if args.resume and previous.is_file():
  old=read(previous);assert old['source_commit']==HEAD and old['argv']==arguments and old['exit_code']==0
  for label in ['stdout','stderr']:assert sha(BASE/old[label]['path'])==old[label]['sha256']
  print(json.dumps({'name':name,'reuse_actual_exit_code':0,'reason':'successful same-source execution preserved'}),flush=True);return old
 clean(); start=datetime.datetime.now(datetime.timezone.utc).isoformat()
 result=subprocess.run(arguments,cwd=ROOT,env=ENV,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 record={'schema':'workloom.independent-execution/v1','name':name,'source_commit':HEAD,'actor':ACTOR,'role':'acceptance',
  'argv':arguments,'cwd':str(ROOT),'started_at':start,'finished_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
  'exit_code':result.returncode,'environment_keys':list(ENV),'environment_values':dict(ENV),
  'external_or_paid_provider':False,'media_creation_allowed':False,'environment_claim':'local-preview'}
 for label,data in [('stdout',result.stdout),('stderr',result.stderr)]:
  path=BASE/(name+'.'+label+'.txt');path.write_bytes(data);record[label]={'path':path.name,'sha256':sha(path)}
 write(BASE/(name+'.run.json'),record);clean()
 print(json.dumps({'name':name,'actual_exit_code':result.returncode,'stdout_tail':result.stdout.decode(errors='replace')[-700:],
  'stderr_tail':result.stderr.decode(errors='replace')[-300:]},ensure_ascii=False),flush=True)
 if result.returncode:raise RuntimeError(name+' failed; original outputs preserved, do not claim acceptance')
 return record
clean(); BASE.mkdir(parents=True,exist_ok=args.resume)
ledger=read(SOURCE/'ledger.json')
assert ledger['task_id']=='T-2026-1006-0001'
assert [row['id'] for row in ledger['cards']]==[CARD]
assert ledger['baseline']['repair']['commit']==HEAD
if args.resume:
 assert read(BASE/'ledger.json')['baseline']['repair']['commit']==HEAD
else:
 shutil.copyfile(SOURCE/'ledger.json',BASE/'ledger.json');copy_reachable(ledger,set())
 assert not (BASE/'evidence-index.json').exists()
# Local declarations/compiled package must belong to this source, never a parent workspace symlink.
for package in ['packages/industry-contract']:
 run('independent-'+package.replace('/','-')+'-build',[NODE,'node_modules/typescript/bin/tsc','-p',package+'/tsconfig.build.json'])
common=[NODE,'scripts/delivery/mine-clear.mjs']
run('independent-acceptance',common+['run-assertions','--ledger',str(BASE/'ledger.json'),'--card',CARD,'--actor',ACTOR,'--role','acceptance','--repo',str(ROOT)])
run('independent-gate',common+['gate','--ledger',str(BASE/'ledger.json'),'--repo',str(ROOT),'--json'])
run('independent-requirement-regression',[NODE,'--import','tsx','--test','scripts/native-requirement-binding.test.mts','scripts/native-requirement-contract.test.mts'])
fixture=CHAT/'work/native-mc023-extra-boundaries-retry.mts';shutil.copyfile(fixture,BASE/'independent-native-prd-extra-retry.mts')
run('independent-native-prd-extra-retry',[NODE,'--import','tsx','--test',str(BASE/'independent-native-prd-extra-retry.mts')])
suites=['packages/video-studio/src/studio.test.ts','apps/server/src/video/studio-worker.test.ts',
 'apps/server/src/video/gate-policy.test.ts','packages/video-studio/src/portrait-archive-bridge.test.ts']
run('independent-native-integration',[NODE,'packages/video-studio/node_modules/vitest/vitest.mjs','run',*suites,
 '--exclude','**/dist-payload/**','--testTimeout','30000','--reporter=default','--reporter=json','--outputFile='+str(BASE/'independent-native-vitest.json')])
def typecheck(package):
 compiler=package+'/node_modules/typescript/bin/tsc' if (ROOT/package/'node_modules/typescript/bin/tsc').is_file() else 'node_modules/typescript/bin/tsc'
 return run('independent-'+package.replace('/','-')+'-typecheck',[NODE,compiler,'--noEmit','-p',package+'/tsconfig.json'])
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:typechecks=list(pool.map(typecheck,['packages/video-studio','apps/server']))
write(BASE/'independent-typechecks.json',typechecks)
run('independent-handoff',common+['handoff','--ledger',str(BASE/'ledger.json'),'--repo',str(ROOT),'--env','local-preview','--json'])
run('independent-gate-after-handoff',common+['gate','--ledger',str(BASE/'ledger.json'),'--repo',str(ROOT),'--json'])
handoff=read(BASE/'handoff.json')
assert handoff['repair_baseline']==HEAD==handoff['acceptance_baseline']
assert handoff['environment_claim']=='local-preview' and len(handoff['closed_problems'])==1 and not handoff['open_problems']
clean();print(json.dumps({'status':'execution-complete-report-and-archive-still-required','source_commit':HEAD,'base':str(BASE)},indent=2),flush=True)
