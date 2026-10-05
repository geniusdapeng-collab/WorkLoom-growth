"""Only MC023 official rebinding and the changed C1 target at immutablec523."""
import datetime,hashlib,json,os,pathlib,shutil,subprocess
CHAT=pathlib.Path(__file__).resolve().parent.parent
ROOT=CHAT/'work/growth-native-acceptance-9c69b8c';PARENT=CHAT/'work/growth-native-pipeline'
HEAD='c523e9e24300755a6f65c018712ad85c1005838d';OLD='98776805f108105a6f5891f1bb3f700331848c78';ACTOR='native-entry-independent-acceptance'
REL=pathlib.Path('outputs/mine-clear/T-2026-1006-0001/independent-c523e9e');BASE=ROOT/REL
SOURCE=CHAT/'outputs/mine-clear/T-2026-1006-0001/repair-c523e9e'
NODEDIR='/Users/mac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin';NODE=NODEDIR+'/node'
ENV={'HOME':os.environ['HOME'],'PATH':NODEDIR+':/usr/bin:/bin:/usr/sbin:/sbin','WORKLOOM_ASSERTION_MODULE_ROOT':str(ROOT),
 'NATIVE_ACCEPTANCE_REPO_ROOT':str(ROOT),'NATIVE_PRD_SOURCE_ROOT':str(ROOT),'WL_FFMPEG':str(CHAT/'work/no-media-operation/ffmpeg-disabled'),'WL_FFPROBE':str(CHAT/'work/no-media-operation/ffprobe-disabled')}
def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def read(p):return json.loads(p.read_text())
def write(p,v):p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(v,ensure_ascii=False,indent=2)+'\n')
def git(repo,*args):return subprocess.check_output(['git',*args],cwd=repo)
def clean():
 assert git(ROOT,'rev-parse','HEAD').decode().strip()==HEAD and not git(ROOT,'status','--porcelain')
def run(name,argv):
 clean();started=datetime.datetime.now(datetime.timezone.utc).isoformat();r=subprocess.run(argv,cwd=ROOT,env=ENV,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
 v={'schema':'workloom.independent-execution/v1','name':name,'source_commit':HEAD,'actor':ACTOR,'role':'acceptance','argv':argv,'cwd':str(ROOT),
  'started_at':started,'finished_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'exit_code':r.returncode,'environment_values':ENV,
  'environment_claim':'local-preview','external_or_paid_provider':False,'media_creation_allowed':False}
 for label,raw in [('stdout',r.stdout),('stderr',r.stderr)]:p=BASE/(name+'.'+label+'.txt');p.write_bytes(raw);v[label]={'path':p.name,'sha256':sha(p)}
 write(BASE/(name+'.run.json'),v);clean();print(json.dumps({'name':name,'actual_exit_code':r.returncode,'stdout_tail':r.stdout.decode(errors='replace')[-900:],'stderr_tail':r.stderr.decode(errors='replace')[-300:]},ensure_ascii=False),flush=True)
 assert r.returncode==0,'Actual failure preserved; do not claim acceptance';return v

clean()
common=[NODE,'scripts/delivery/mine-clear.mjs']
title='runPreproduction 经现有兼容入口安装并消费 Phase3，失败与成功均卸载还原'
run('independent-c1-target-retry',[NODE,'packages/video-studio/node_modules/vitest/vitest.mjs','run','packages/video-studio/src/vendor-compat.test.ts','-t',title,
 '--exclude','**/dist-payload/**','--exclude','**/outputs/**','--testTimeout','120000','--reporter=default','--reporter=json',
 '--outputFile='+str(BASE/'independent-c1-vitest-retry.json')])
target=read(BASE/'independent-c1-vitest-retry.json');assert target['success'] and target['numPassedTests']==1 and target['numFailedTests']==0
assert target['numTotalTests']==31 and target['numPendingTests']==30 and len(target['testResults'])==1
run('independent-handoff',common+['handoff','--ledger',str(BASE/'ledger.json'),'--repo',str(ROOT),'--env','local-preview','--json'])
run('independent-gate-after-handoff',common+['gate','--ledger',str(BASE/'ledger.json'),'--repo',str(ROOT),'--json'])
handoff=read(BASE/'handoff.json');assert handoff['repair_baseline']==HEAD==handoff['acceptance_baseline'] and len(handoff['closed_problems'])==1 and not handoff['open_problems']
clean();print(json.dumps({'status':'current-formal39-and-target1-pass','source_commit':HEAD,'base':str(BASE),'old16_11_91_types_not_rerun':True,'initial_archive_collection_failure_preserved':True},ensure_ascii=False),flush=True)
