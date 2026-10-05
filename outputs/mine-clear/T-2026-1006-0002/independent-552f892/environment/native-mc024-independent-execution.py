"""Execute the authorized MC024 local acceptance on the independent clean source."""
import datetime, hashlib, json, os, pathlib, shutil, subprocess, sys

CHAT = pathlib.Path(__file__).resolve().parent.parent
ROOT = CHAT / 'work/growth-native-acceptance-9c69b8c'
SOURCE = '552f892edd2d97f264c7bfc2d23c8c7db472ff91'
ACTOR = 'native-entry-independent-acceptance'
BASE = ROOT / 'outputs/mine-clear/T-2026-1006-0002/independent-552f892'
ORIGINAL = CHAT / 'outputs/mine-clear/T-2026-1006-0002'
PREP = CHAT / 'work/native-mc024-preparation'
NODE = pathlib.Path('/Users/mac/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node')
ENV = {'PATH': str(NODE.parent) + ':/usr/bin:/bin:/usr/sbin:/sbin',
       'TMPDIR': '/tmp', 'CI': 'true', 'TZ': 'UTC', 'LANG': 'en_US.UTF-8',
       'GIT_TERMINAL_PROMPT': '0', 'GIT_ASKPASS': '',
       'WL_FFMPEG': '/Users/mac/.local/bin/ffmpeg', 'WL_FFPROBE': '/Users/mac/.local/bin/ffprobe'}

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()

def git(*args):
    return subprocess.check_output(['/usr/bin/git', *args], cwd=ROOT, env=ENV)

def guard():
    head = git('rev-parse', 'HEAD').decode().strip()
    status = git('status', '--porcelain', '--untracked-files=normal').decode()
    if head != SOURCE or status:
        raise RuntimeError('Independent source identity changed: ' + head + ' ' + status)
    return {'commit': head, 'working_tree_dirty': False}

def capture(label, argv, timeout=240):
    target = BASE / 'operations' / (label + '.run.json')
    if target.exists():
        raise RuntimeError('Actual operation already exists; refusing overwrite: ' + label)
    before = guard(); started = stamp(); timed_out = False
    try:
        result = subprocess.run(argv, cwd=ROOT, env=ENV, capture_output=True, timeout=timeout)
        stdout, stderr, code = result.stdout, result.stderr, result.returncode
    except subprocess.TimeoutExpired as error:
        stdout, stderr, code, timed_out = error.stdout or b'', error.stderr or b'', 124, True
    after = guard()
    stdout_path, stderr_path = target.with_name(label + '.stdout.txt'), target.with_name(label + '.stderr.txt')
    stdout_path.parent.mkdir(parents=True, exist_ok=True)
    stdout_path.write_bytes(stdout); stderr_path.write_bytes(stderr)
    receipt = {'schema': 'workloom.independent-mc024-actual-operation/v1', 'actor': ACTOR,
        'role': 'acceptance', 'cwd': str(ROOT), 'argv': argv, 'started_at': started,
        'finished_at': stamp(), 'exit_code': code, 'timed_out': timed_out,
        'source_before': before, 'source_after': after, 'environment_keys': sorted(ENV),
        'stdout': str(stdout_path.relative_to(BASE)), 'stderr': str(stderr_path.relative_to(BASE)),
        'stdout_sha256': sha(stdout_path), 'stderr_sha256': sha(stderr_path)}
    write(target, receipt)
    print(json.dumps({'operation': label, 'exit_code': code, 'commit': SOURCE, 'run': str(target)}), flush=True)
    if code:
        print(stdout.decode(errors='replace')[-8000:]); print(stderr.decode(errors='replace')[-8000:])
        raise RuntimeError('Actual operation failed, raw receipt retained: ' + label)
    return receipt

def owned_selection(package, version, tail):
    closure = json.loads((PREP / 'selected-transitive-dependency-closure.json').read_text())
    choices = [ROOT / x['path'] / tail for x in closure['packages']
        if x['package'] == package and x['version'] == version]
    for path in choices:
        resolved = path.resolve(strict=True)
        if resolved.is_file() and resolved.is_relative_to(ROOT):
            return resolved
    raise RuntimeError('Owned selected dependency unavailable: ' + package)

def prepare():
    exclude = pathlib.Path(git('rev-parse', '--git-path', 'info/exclude').decode().strip())
    if not exclude.is_absolute(): exclude = ROOT / exclude
    line = '/outputs/mine-clear/T-2026-1006-0002/independent-552f892/'
    text = exclude.read_text() if exclude.exists() else ''
    if line not in text.splitlines():
        exclude.parent.mkdir(parents=True, exist_ok=True); exclude.write_text(text.rstrip() + '\n' + line + '\n')
    guard()
    if BASE.exists(): raise RuntimeError('New acceptance destination must not preexist')
    BASE.mkdir(parents=True)
    ledger_path = ORIGINAL / 'repair-green/ledger.json'
    ledger = json.loads(ledger_path.read_text())
    copy_log = []
    def copy_ref(ref):
        if not isinstance(ref, dict): return
        if not all(k in ref for k in ('path', 'sha256', 'commit')): return
        relative = pathlib.Path(ref['path'])
        if relative.is_absolute() or '..' in relative.parts: raise RuntimeError('Unsafe historical ref')
        candidates = [ORIGINAL / 'repair-green' / relative, ORIGINAL / 'repair-current' / relative]
        source = next((p for p in candidates if p.is_file() and sha(p) == ref['sha256']), None)
        if not source: raise RuntimeError('Historical ref not readable: ' + ref['path'])
        target = BASE / relative
        if not target.exists():
            target.parent.mkdir(parents=True, exist_ok=True); shutil.copyfile(source, target)
            copy_log.append({'original': str(source), 'copy': ref['path'], 'sha256': sha(target), 'commit': ref['commit']})
            if relative.suffix == '.json':
                for child in json.loads(source.read_text()).get('outputs', []): copy_ref(child)
    for assertion in ledger['cards'][0]['assertions']:
        copy_ref(assertion['run']); copy_ref(assertion['evidence'])
    copy_ref(ledger['baseline']['repair']['red_run'])
    shutil.copyfile(ledger_path, BASE / 'historical-repair-ledger.json')
    write(BASE / 'historical-reference-copy.json', {'copies': copy_log,
        'observer_paths_preserved': True, 'copy_is_not_an_execution': True})
    loader = owned_selection('tsx', '4.23.13', 'dist/loader.mjs')
    vitest = owned_selection('vitest', '5.0.2', 'vitest.mjs')
    compiler = owned_selection('typescript', '7.0.2', 'bin/tsc')
    video_compiler = owned_selection('typescript', '5.9.3', 'bin/tsc')
    changes = []
    for assertion in ledger['cards'][0]['assertions']:
        old = json.loads(json.dumps(assertion['exec']))
        args = assertion['exec']['args']; args[args.index('--import') + 1] = str(loader)
        assertion['exec']['file'] = str(NODE)
        assertion['command'] = str(NODE) + ' ' + ' '.join(args)
        changes.append({'historical_requested_exec': old, 'acceptance_requested_exec': assertion['exec']})
    ledger['repo_path'] = str(ROOT)
    ledger['repo'] = 'growth-native-acceptance-9c69b8c'
    ledger['environment'] = {'kind': 'local-preview',
        'notes': 'Independent complete tracked checkout. Owned copied selected transitive dependencies; minimal credential-free environment. Fixed model replies, loopback HTTP fixture, deterministic own ffmpeg fixture only. No business service, PG, provider/customer media or remote writes.'}
    ledger['cards'][0]['regression']['command'] = ' && '.join(a['command'] for a in ledger['cards'][0]['assertions'])
    write(BASE / 'ledger.json', ledger)
    write(BASE / 'execution-rebind.json', {'source_commit': SOURCE, 'actor': ACTOR,
        'changes': changes, 'repair_baseline_preserved': ledger['baseline']['repair'],
        'historical_refs_unchanged': True, 'node': {'path': str(NODE), 'sha256': sha(NODE)},
        'loader': {'path': str(loader), 'sha256': sha(loader)}, 'vitest': {'path': str(vitest), 'sha256': sha(vitest)},
        'compiler': str(compiler), 'video_compiler': str(video_compiler),
        'ffmpeg': {'path': ENV['WL_FFMPEG'], 'sha256': sha(pathlib.Path(ENV['WL_FFMPEG']))},
        'ffprobe': {'path': ENV['WL_FFPROBE'], 'sha256': sha(pathlib.Path(ENV['WL_FFPROBE']))}})
    return vitest, compiler, video_compiler

def main():
    vitest, compiler, video_compiler = prepare()
    capture('owned-industry-contract-build', [str(NODE), str(compiler), '-p', 'packages/industry-contract/tsconfig.build.json'])
    capture('ffmpeg-identity', [ENV['WL_FFMPEG'], '-version'])
    capture('ffprobe-identity', [ENV['WL_FFPROBE'], '-version'])
    common = [str(NODE), 'scripts/delivery/mine-clear.mjs']
    ledger = str(BASE / 'ledger.json')
    capture('formal-independent-assertions', common + ['run-assertions', '--ledger', ledger,
        '--repo', str(ROOT), '--card', 'MC-024', '--actor', ACTOR, '--role', 'acceptance', '--timeout-ms', '240000'], 520)
    capture('formal-independent-gate', common + ['gate', '--ledger', ledger, '--repo', str(ROOT), '--json'])
    capture('narrow-producer-facts-authority-regression', [str(NODE), str(vitest), 'run',
        'packages/video-studio/src/producer-gate.test.ts', 'apps/server/src/video/marketing-facts.test.ts',
        'apps/server/src/video/marketing-authority.test.ts', '--maxWorkers=1', '--no-file-parallelism',
        '--exclude', '**/outputs/**', '--exclude', '**/dist-payload/**', '--reporter=json',
        '--outputFile=' + str(BASE / 'narrow-producer-facts-authority-vitest.json'), '--testTimeout=30000'])
    report = json.loads((BASE / 'narrow-producer-facts-authority-vitest.json').read_text())
    if not report.get('success') or report.get('numTotalTests') != 90 or report.get('numPassedTests') != 90 or report.get('numPendingTests') != 0:
        raise RuntimeError('Actual narrow case summary is not90 passed/zero skipped')
    capture('video-studio-typecheck', [str(NODE), str(video_compiler), '--noEmit', '-p', 'packages/video-studio/tsconfig.json'])
    capture('server-typecheck', [str(NODE), str(compiler), '--noEmit', '-p', 'apps/server/tsconfig.json'])
    capture('formal-independent-handoff', common + ['handoff', '--ledger', ledger, '--repo', str(ROOT),
        '--env', 'local-preview', '--out', str(BASE), '--json'])
    capture('formal-independent-posthandoff-gate', common + ['gate', '--ledger', ledger, '--repo', str(ROOT), '--json'])
    write(BASE / 'execution-complete.json', {'source_commit': SOURCE, 'actor': ACTOR, 'role': 'acceptance',
        'environment': 'local-preview', 'official_assertion_case_count': 56, 'narrow_vitest_case_count': 90,
        'source_final': guard(), 'completed_at': stamp()})

if __name__ == '__main__': main()
