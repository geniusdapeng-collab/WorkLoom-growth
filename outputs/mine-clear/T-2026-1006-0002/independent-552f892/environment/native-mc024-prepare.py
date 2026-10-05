"""Prepare an owned, complete MC024 checkout without executing acceptance."""
import datetime, hashlib, json, os, pathlib, subprocess

CHAT = pathlib.Path(__file__).resolve().parent.parent
ROOT = CHAT / 'work/growth-native-acceptance-9c69b8c'
PARENT = CHAT / 'work/growth-native-pipeline'
HEAD = '5bee55d6a754462ca60cdf2a98bd9b1e6807193d'
OUT = CHAT / 'work/native-mc024-preparation'
OUT.mkdir(exist_ok=True)

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def git(*args):
    return subprocess.check_output(['git', *args], cwd=ROOT)

def write(name, value):
    (OUT / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

assert git('rev-parse', 'HEAD').decode().strip() == HEAD
assert not git('status', '--porcelain')
old_seals = {}
for folder in ['independent-19fff17', 'independent-9877680', 'independent-c523e9e']:
    path = ROOT / 'outputs/mine-clear/T-2026-1006-0001' / folder / 'independent-archive-manifest.json'
    old_seals[str(path)] = sha(path)

input_paths = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml',
    'apps/server/package.json', 'packages/video-studio/package.json',
    'packages/base/package.json', 'packages/runtime/package.json',
    'packages/shared/package.json', 'packages/db/package.json',
    'packages/industry-contract/package.json', 'packages/audit-engine/package.json']
inputs = []
for name in input_paths:
    assert sha(ROOT / name) == sha(PARENT / name), name
    inputs.append({'path': name, 'sha256': sha(ROOT / name), 'same_as_installed_source': True})

operations = []
source = PARENT / 'node_modules'
target = ROOT / 'node_modules'
assert source.is_dir()
if not target.exists():
    argv = ['/bin/cp', '-cR', str(source), str(target)]
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    process = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    operations.append({'argv': argv, 'started_at': started,
        'finished_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'exit_code': process.returncode, 'stdout': process.stdout.decode(errors='replace'),
        'stderr': process.stderr.decode(errors='replace')})
    write('dependency-clone-operation.json', operations)
    assert process.returncode == 0, 'Owned APFS clone failed; actual output preserved.'
else:
    operations = json.loads((OUT / 'dependency-clone-operation.json').read_text())
    assert operations[0]['exit_code'] == 0 and operations[0]['argv'][-1] == str(target)

# Preserve the earlier owned wrappers, then clone currently installed parent wrappers.
# This updates only our environment, retaining older caches and previous evidence.
package_roots = ['apps/server/node_modules', 'packages/video-studio/node_modules',
    'packages/base/node_modules', 'packages/runtime/node_modules',
    'packages/shared/node_modules', 'packages/db/node_modules',
    'packages/audit-engine/node_modules', 'packages/industry-contract/node_modules']
retained = OUT / 'retained-owned-dependency-wrappers'
wrapper_operations = []
for rel in package_roots:
    previous = ROOT / rel
    archive = retained / rel
    archive.parent.mkdir(parents=True, exist_ok=True)
    if archive.exists():
        continue
    assert previous.is_dir()
    previous.rename(archive)
    argv = ['/bin/cp', '-cR', str(PARENT / rel), str(previous)]
    process = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    wrapper_operations.append({'argv': argv, 'exit_code': process.returncode,
        'retained_previous_owned_wrapper': str(archive),
        'stdout': process.stdout.decode(errors='replace'),
        'stderr': process.stderr.decode(errors='replace')})
    write('dependency-wrapper-clone-operation.json', wrapper_operations)
    assert process.returncode == 0, 'Owned wrapper clone failed; original wrappers retained.'

# Only the new owned clone is rebased. Existing owned package roots are retained.
rebased = []
for rel in ['node_modules', *package_roots]:
  for current, directories, files in os.walk(ROOT / rel, followlinks=False):
    for name in directories + files:
        path = pathlib.Path(current) / name
        if not path.is_symlink():
            continue
        resolved = path.resolve()
        if resolved.is_relative_to(ROOT):
            continue
        raw = os.readlink(path)
        if resolved.is_relative_to(PARENT):
            owned = ROOT / resolved.relative_to(PARENT)
        elif name in ['.vite', '.vite-temp']:
            # Existing parent links are obsolete cache pointers. Recreate only owned caches.
            path.unlink()
            path.mkdir()
            rebased.append({'path': str(path.relative_to(ROOT)), 'old_raw': raw,
                'owned_cache_directory_created': True})
            continue
        elif '/node_modules/' in str(resolved):
            suffix = str(resolved).split('/node_modules/', 1)[1]
            owned = ROOT / 'node_modules' / suffix
        else:
            raise RuntimeError('Unmapped foreign clone link: ' + str(path))
        assert owned.exists(), str(owned)
        path.unlink()
        path.symlink_to(os.path.relpath(owned, path.parent), target_is_directory=owned.is_dir())
        rebased.append({'path': str(path.relative_to(ROOT)), 'old_raw': raw,
            'new_raw': os.readlink(path), 'owned_resolved': str(owned)})

dependency_roots = ['node_modules', 'apps/server/node_modules',
    'packages/video-studio/node_modules', 'packages/base/node_modules',
    'packages/runtime/node_modules', 'packages/shared/node_modules',
    'packages/db/node_modules', 'packages/audit-engine/node_modules',
    'packages/industry-contract/node_modules']
workspace_names = {}
for package in [*ROOT.glob('packages/*/package.json'), *ROOT.glob('apps/*/package.json')]:
    metadata = json.loads(package.read_text())
    if 'name' in metadata:
        workspace_names[metadata['name']] = package.parent
workspace_links = []
for rel in dependency_roots[1:]:
    package = ROOT / pathlib.Path(rel).parent
    metadata = json.loads((package / 'package.json').read_text())
    declarations = metadata.get('dependencies', {}) | metadata.get('devDependencies', {})
    for name, version in declarations.items():
        if not version.startswith('workspace:'):
            continue
        path = ROOT / rel / name
        expected = workspace_names[name]
        assert path.exists() and path.resolve() == expected.resolve(), str(path)
        workspace_links.append({'path': str(path.relative_to(ROOT)),
            'package': name, 'resolved': str(path.resolve()), 'source_owned': True})

all_links, missing, foreign = [], [], []
for rel in dependency_roots:
    assert (ROOT / rel).is_dir(), rel
    for current, directories, files in os.walk(ROOT / rel, followlinks=False):
        for name in directories + files:
            path = pathlib.Path(current) / name
            if not path.is_symlink():
                continue
            row = {'path': str(path.relative_to(ROOT)), 'raw': os.readlink(path),
                'resolved': str(path.resolve()), 'exists': path.exists()}
            all_links.append(row)
            if not path.exists():
                missing.append(row)
            if not path.resolve().is_relative_to(ROOT):
                foreign.append(row)
write('dependency-store-link-audit.json', {'all_links': all_links,
    'missing_links': missing, 'foreign_links': foreign,
    'scope': 'Entire copied installed store, including stale unselected versions.'})
assert not foreign, 'Foreign source or dependency link audit failed.'

# The installed store also contains stale, unselected versions. Validate every declared
# transitive dependency reachable from the actual tools/package wrappers instead of
# pretending those unrelated orphan entries are a complete new installation.
seeds = [ROOT / 'node_modules/tsx', ROOT / 'node_modules/typescript',
    ROOT / 'packages/video-studio/node_modules/vitest',
    ROOT / 'packages/video-studio/node_modules/typescript',
    ROOT / 'apps/server/node_modules/typescript']
for rel in package_roots:
    wrapper = ROOT / rel
    for path in wrapper.iterdir():
        if path.name.startswith('@') and path.is_dir():
            seeds.extend(path.iterdir())
        elif not path.name.startswith('.'):
            seeds.append(path)
queue = [path.resolve() for path in seeds if (path / 'package.json').is_file()]
seen, closure, unresolved_optional = set(), [], []
def module_path(package, name):
    current = package
    while current.is_relative_to(ROOT):
        candidate = current / 'node_modules' / name
        if (candidate / 'package.json').is_file():
            return candidate.resolve()
        if current == ROOT:
            break
        current = current.parent
    return None
while queue:
    package = queue.pop()
    if package in seen:
        continue
    seen.add(package)
    assert package.is_relative_to(ROOT)
    metadata = json.loads((package / 'package.json').read_text())
    dependencies = metadata.get('dependencies', {})
    optional = metadata.get('optionalDependencies', {})
    resolved_dependencies = []
    for name in dependencies | optional:
        resolved = module_path(package, name)
        if resolved is None:
            if name in optional:
                unresolved_optional.append({'package': str(package), 'dependency': name,
                    'declared': optional[name], 'reason': 'Optional dependency not installed for selected host.'})
                continue
            raise RuntimeError('Required selected transitive dependency missing: ' + str(package) + ' -> ' + name)
        resolved_dependencies.append({'name': name, 'resolved': str(resolved)})
        queue.append(resolved)
    closure.append({'package': metadata.get('name'), 'version': metadata.get('version'),
        'path': str(package.relative_to(ROOT)), 'package_json_sha256': sha(package / 'package.json'),
        'resolved_dependencies': resolved_dependencies})
write('selected-transitive-dependency-closure.json', {'packages': closure,
    'optional_not_installed': unresolved_optional, 'required_missing': [],
    'entire_store_orphans': missing, 'grade': 'B', 'source_or_dependency_foreign_links': []})

tracked = []
for raw in git('ls-files', '-z').split(b'\0'):
    if not raw:
        continue
    name = os.fsdecode(raw)
    path = ROOT / name
    if path.is_symlink():
        content = os.readlink(path).encode()
        kind = 'symlink'
    else:
        assert path.is_file(), name
        content = path.read_bytes()
        kind = 'regular file'
    canonical = subprocess.check_output(['git', 'show', HEAD + ':' + name], cwd=ROOT)
    assert content == canonical, name
    tracked.append({'path': name, 'bytes': len(content),
        'sha256': hashlib.sha256(content).hexdigest(), 'kind': kind})

for name, digest in old_seals.items():
    assert sha(pathlib.Path(name)) == digest, 'Prior MC023 seal changed.'
assert not git('status', '--porcelain')
write('owned-complete-environment.json', {
    'schema': 'workloom.independent-mc024-preparation/v1',
    'source_commit': HEAD, 'actor': 'native-entry-independent-acceptance',
    'stage': 'preparation-only; no formal acceptance execution',
    'tracked_count': len(tracked), 'trackedFiles': tracked,
    'dependencyRoots': dependency_roots, 'declarationInputs': inputs,
    'workspace_links': workspace_links, 'rebased_cloned_links': rebased,
    'all_dependency_links': all_links, 'foreign_links': foreign, 'missing_links': missing,
    'prior_mc023_seal_manifest_hashes': old_seals,
    'whole_tree': git('rev-parse', HEAD + '^{tree}').decode().strip(),
    'formal_acceptance_started': False, 'provider_or_media_business_or_pg': False,
    'no_install': True, 'owned_existing_package_dependency_roots_retained': True,
    'selected_transitive_packages': len(closure), 'optional_not_installed': unresolved_optional,
    'unselected_installed_store_orphan_links_explicit': True})
print(json.dumps({'result': 'preparation-complete', 'source': HEAD,
    'tracked_files': len(tracked), 'dependency_roots': len(dependency_roots),
    'dependency_links': len(all_links), 'workspace_links': len(workspace_links),
    'foreign_links': len(foreign), 'unselected_store_missing_links': len(missing),
    'selected_transitive_packages': len(closure), 'selected_required_missing': 0,
    'rebased_new_clone_links': len(rebased), 'formal_acceptance_started': False}, indent=2))
