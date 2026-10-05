import argparse, datetime, hashlib, json, os, pathlib, shutil, subprocess

parser = argparse.ArgumentParser()
parser.add_argument('source_commit')
parser.add_argument('--resume', action='store_true')
args = parser.parse_args()
root = pathlib.Path(__file__).resolve().parent.parent
source = root / 'work/growth-native-pipeline'
target = root / 'work/growth-native-acceptance-9c69b8c'
expected = args.source_commit
output = root / ('work/native-entry-prepare-' + expected[:7] + '.json')
dep_paths = ['node_modules', 'apps/server/node_modules', 'packages/audit-engine/node_modules', 'packages/base/node_modules', 'packages/db/node_modules', 'packages/industry-contract/node_modules', 'packages/runtime/node_modules', 'packages/shared/node_modules', 'packages/video-studio/node_modules']

def git(repo, *items):
    return subprocess.check_output(['git', '-C', str(repo), *items])

def identity(repo):
    assert git(repo, 'rev-parse', 'HEAD').decode().strip() == expected
    assert not git(repo, 'status', '--porcelain'), 'Source must be clean at expected commit'

assert len(expected) == 40 and all(c in '0123456789abcdef' for c in expected)
assert args.resume and target.exists(), 'Resume only the pre-existing owned full checkout'
identity(target)
identity(source)
started = datetime.datetime.now(datetime.timezone.utc).isoformat()
before = shutil.disk_usage(root).free
if not args.resume:
    subprocess.run(['git', '-C', str(source), 'worktree', 'add', '--detach', '--no-checkout', str(target), expected], check=True)
    subprocess.run(['git', '-C', str(target), 'read-tree', expected], check=True)
names = git(source, 'ls-tree', '-r', '-z', '--name-only', expected).split(b'\0')
file_rows = []
for name in names:
    if not name:
        continue
    relative = pathlib.Path(os.fsdecode(name))
    assert not relative.is_absolute() and '..' not in relative.parts
    src, dst = source / relative, target / relative
    dst.parent.mkdir(parents=True, exist_ok=True)
    if src.is_symlink():
        if not dst.is_symlink():
            dst.symlink_to(os.readlink(src))
        assert os.readlink(dst) == os.readlink(src)
        digest = hashlib.sha256(os.readlink(src).encode()).hexdigest()
        kind = 'symlink'
    else:
        assert src.is_file(), 'Tracked source unavailable: ' + str(relative)
        if not dst.exists():
            subprocess.run(['/bin/cp', '-c', str(src), str(dst)], check=True)
        digest = hashlib.sha256(dst.read_bytes()).hexdigest()
        assert digest == hashlib.sha256(src.read_bytes()).hexdigest()
        kind = 'file'
    file_rows.append({'path': relative.as_posix(), 'kind': kind, 'sha256': digest})
identity(source)
identity(target)
for relative in dep_paths:
    src, dst = source / relative, target / relative
    assert src.is_dir()
    if not dst.exists():
        subprocess.run(['/bin/cp', '-cR', str(src), str(dst)], check=True)
normalizations = []
for relative in dep_paths:
    base = target / relative
    for directory, dirs, files in os.walk(base, followlinks=False):
        for name in [*dirs, *files]:
            p = pathlib.Path(directory) / name
            if not p.is_symlink() or target in p.resolve().parents:
                continue
            old_link = os.readlink(p)
            rel = p.relative_to(target).as_posix()
            if name in ['.vite', '.vite-temp']:
                p.unlink()
                p.mkdir()
                normalizations.append({'path': rel, 'originalLink': old_link, 'action': 'Replace copied foreign cache symlink with empty owned cache directory'})
            elif rel in ['node_modules/@types/pg', 'node_modules/@types/react', 'node_modules/@types/react-dom']:
                resolved = p.resolve()
                assert resolved.is_dir()
                p.unlink()
                subprocess.run(['/bin/cp', '-cR', str(resolved), str(p)], check=True)
                rows = [{'path': q.relative_to(p).as_posix(), 'sha256': hashlib.sha256(q.read_bytes()).hexdigest()} for q in sorted(p.rglob('*')) if q.is_file()]
                normalizations.append({'path': rel, 'originalLink': old_link, 'action': 'APFS clone exact existing declaration files into owned dependency tree', 'files': rows})
links, foreign, broken = [], [], []
for relative in dep_paths:
    base = target / relative
    for directory, dirs, files in os.walk(base, followlinks=False):
        for name in [*dirs, *files]:
            p = pathlib.Path(directory) / name
            if p.is_symlink():
                resolved = p.resolve()
                row = {'path': p.relative_to(target).as_posix(), 'link': os.readlink(p), 'resolved': str(resolved)}
                links.append(row)
                if not resolved.exists():
                    broken.append(row)
                if target not in resolved.parents:
                    foreign.append(row)
assert not foreign, 'Dependency links outside independent checkout: ' + json.dumps(foreign[:5])
for row in broken:
    parent_link = source / row['path']
    assert parent_link.is_symlink() and os.readlink(parent_link) == row['link'] and not parent_link.resolve().exists(), 'A newly broken independent link is not acceptable'
for tool in ['node_modules/tsx/package.json', 'node_modules/typescript/bin/tsc', 'packages/video-studio/node_modules/vitest/vitest.mjs']:
    assert (target / tool).is_file(), 'Executed tool is unavailable: ' + tool
identity(source)
identity(target)
report = {'schema': 'workloom.independent-checkout-preparation/v1', 'actor': 'native-entry-independent-acceptance', 'sourceCommit': expected, 'sourceRoot': str(source), 'acceptanceRoot': str(target), 'startedAt': started, 'finishedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'completeTrackedFiles': len(file_rows), 'trackedFilesCopyMode': 'Per-file APFS clone; symlink literal preserved; source and target clean Git status against exact same commit', 'trackedFiles': file_rows, 'dependencyRoots': dep_paths, 'dependencyCopyMode': 'APFS cp -cR; relative links retain isolated workspace ownership', 'dependencyNormalizations': normalizations, 'dependencyLinks': links, 'foreignDependencyLinks': foreign, 'brokenDependencyLinks': broken, 'brokenDependencyScope': 'Unchanged pre-existing unrelated UI/alternate tooling links are retained as environment exclusions; selected Node/tsx/TypeScript/Vitest entries and all workspace links are verified in the owned tree.', 'availableBytesBefore': before, 'availableBytesAfter': shutil.disk_usage(root).free, 'readOnlyProductSource': True, 'noProviderCalls': True}
output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({k: report[k] for k in ['sourceCommit', 'acceptanceRoot', 'completeTrackedFiles', 'dependencyRoots', 'availableBytesBefore', 'availableBytesAfter']}, ensure_ascii=False))
