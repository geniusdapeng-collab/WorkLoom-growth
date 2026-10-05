#!/usr/bin/env python3
# -*- coding: utf-8 -*-
from pathlib import Path
import json
import subprocess
import hashlib
import datetime

CHAT = Path('/Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30')
ROOT = CHAT / 'work/growth-facts-scoring-mc024'
CANONICAL = CHAT / 'work/growth-native-pipeline'
OUT = CHAT / 'outputs/mine-clear/T-2026-1006-0002'
OUT.mkdir(parents=True, exist_ok=True)
workspace = {}
for file in (ROOT / 'packages').glob('*/package.json'):
    manifest = json.loads(file.read_text())
    if manifest.get('name'): workspace[manifest['name']] = file.parent
module_origins = []
def link_tree(relative):
    source = CANONICAL / relative
    target = ROOT / relative
    if not source.exists(): return
    if target.is_symlink(): target.unlink()
    if target.exists():
        # Existing task-owned dependency trees were created by this helper; never replace them.
        return
    target.mkdir(parents=True)
    for child in source.iterdir():
        if child.name.startswith('@') and child.is_dir():
            scope = target / child.name; scope.mkdir()
            for package in child.iterdir():
                name = child.name + '/' + package.name
                origin = workspace.get(name, package.resolve())
                (scope / package.name).symlink_to(origin, target_is_directory=origin.is_dir())
                module_origins.append({'from': str((scope/package.name).relative_to(ROOT)), 'to': str(origin), 'workspace': name in workspace})
        else:
            origin = workspace.get(child.name, child.resolve())
            (target / child.name).symlink_to(origin, target_is_directory=origin.is_dir())
            module_origins.append({'from': str((target/child.name).relative_to(ROOT)), 'to': str(origin), 'workspace': child.name in workspace})
relatives = ['node_modules','apps/server/node_modules']
relatives.extend(str(directory.relative_to(CANONICAL)) for directory in (CANONICAL/'packages').glob('*/node_modules') if directory.exists())
for relative in relatives:
    link_tree(relative)

dependency_checks = []
for file in [ROOT/'package.json',ROOT/'apps/server/package.json',*(ROOT/'packages').glob('*/package.json')]:
    manifest = json.loads(file.read_text())
    for section in ['dependencies','devDependencies']:
        for name in manifest.get(section, {}):
            options = [file.parent/'node_modules'/name,ROOT/'node_modules'/name]
            resolved = next((option.resolve() for option in options if option.exists()),None)
            if resolved is None: raise RuntimeError('Missing declared dependency '+name+' for '+str(file.relative_to(ROOT)))
            dependency_checks.append({'manifest':str(file.relative_to(ROOT)),'section':section,'package':name,'resolvedPath':str(resolved),'exists':True})

required = [
    'packages/video-studio/src/producer-gate.ts', 'packages/video-studio/src/shot-intent.ts',
    'packages/video-studio/src/device-policy.ts','packages/video-studio/src/scene-bible.ts',
    'packages/video-studio/src/era-profile.ts','packages/video-studio/src/index.ts',
    'packages/video-studio/src/native-marketing-dossier.ts','packages/video-studio/src/source-restrictions.ts',
    'packages/video-studio/src/studio.ts','packages/video-studio/src/llm-adapter.ts',
    'bundles/ai-video/connectors/cine-kb-bridge/shot-intent.mjs',
    'bundles/ai-video/connectors/cine-kb-bridge/shot-intent.d.mts',
    'apps/server/src/video/marketing-facts.ts','apps/server/src/video/marketing-authority.ts',
    'apps/server/src/video/marketing-extraction.ts','apps/server/src/video/marketing-source-fetcher.ts',
    'apps/server/src/video/product-source-policy.ts','apps/server/src/video/product-archive-source.ts',
    'apps/server/src/video/gen/compiled-request.ts',
    'vendor/supermickey/hyperreality-system/index.js',
    'vendor/supermickey/hyperreality-system/engines/data-mining-engine/index.js',
    'scripts/native-marketing-facts-scoring.test.mts','scripts/native-marketing-review.test.mts',
    'scripts/native-marketing-extraction.test.mts','scripts/native-marketing-dossier.test.mts',
]
files = []
for name in required:
    file = ROOT/name
    if not file.is_file(): raise RuntimeError('Missing planned runtime dependency: '+name)
    files.append({'path':name,'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
OUT.joinpath('environment-preflight.json').write_text(json.dumps({
    'schema':'workloom.mc024-environment-preflight/v1',
    'actor':'/root/mc024_facts_scoring_repair','role':'repair',
    'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),
    'commit':subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
    'sparsePaths':subprocess.check_output(['git','sparse-checkout','list'],cwd=ROOT,text=True).splitlines(),
    'plannedRuntimeFiles':files,'dependencyModuleOrigins':module_origins,'declaredDependencyChecks':dependency_checks,
    'note':'Source workspace packages resolve to the owned task checkout. Third-party dependencies are read-only symlinks to existing installed dependencies; no install or source substitution occurred.',
},indent=2)+'\n')
OUT.joinpath('environment-incident.json').write_text(json.dumps({
    'schema':'workloom.mc024-environment-incident/v1',
    'incident':'An ignored out-of-cone temporary evidence directory was removed by git sparse-checkout add.',
    'lostRunId':'MC-024-0-1791239921092',
    'observedCommit':'6e0606c78c21d64856b9e9966a445d88ef24fbd7',
    'observedMachineSummary':{'tests':0,'passed':0,'failed':0,'files':0,'success':False},
    'observedError':'ERR_MODULE_NOT_FOUND: owned bundles/ai-video/connectors/cine-kb-bridge/shot-intent.mjs was not materialized.',
    'lostRunOriginalFilesRetained':False,
    'evidenceGrade':'D: historical metadata copied from tool observation; not the lost original run or an artifact hash proof.',
    'validFormalRed':False,
    'affectedOriginalRuntimeArchive':False,
    'affectedPackagedPreparationEvidence':False,
    'remediation':'Plan complete runtime dependencies and keep formal MCD artifacts in a separate external artifactRoot. Run a new actual clean test-only red after dependency preflight.',
},indent=2)+'\n')
print(json.dumps({'requiredFiles':len(files),'moduleLinks':len(module_origins),'externalArtifactRoot':str(OUT)}))
