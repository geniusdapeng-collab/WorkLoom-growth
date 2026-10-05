#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Capture actual argv/process output for MC024; no shell, credential access or inferred pass."""
from pathlib import Path
import subprocess
import hashlib
import datetime
import json
import os
import sys

ARTIFACT = Path('/Users/mac/Documents/Codex/2026-10-05/growth-codex-growth-growth-ceo-30/outputs/mine-clear/T-2026-1006-0002')
def stamp():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()
def run(label, cwd, argv, timeout=120):
    destination = ARTIFACT / 'operations'
    destination.mkdir(parents=True, exist_ok=True)
    target = destination / (label + '.run.json')
    if target.exists():
        raise RuntimeError('Refuse to overwrite existing actual run: ' + str(target))
    env = os.environ.copy()
    env['GIT_TERMINAL_PROMPT'] = '0'
    env['GIT_ASKPASS'] = ''
    start = stamp()
    result = subprocess.run(argv, cwd=cwd, capture_output=True, text=True, env=env, timeout=timeout)
    stdout = destination / (label + '.stdout.txt')
    stderr = destination / (label + '.stderr.txt')
    stdout.write_text(result.stdout, encoding='utf-8')
    stderr.write_text(result.stderr, encoding='utf-8')
    revision = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=cwd, text=True).strip()
    dirty = bool(subprocess.check_output(['git', 'status', '--porcelain'], cwd=cwd, text=True).strip())
    target.write_text(json.dumps({
        'schema': 'workloom.mc024-actual-operation/v1', 'actor': '/root/mc024_facts_scoring_repair',
        'role': 'repair', 'cwd': str(Path(cwd).resolve()), 'argv': argv, 'startedAt': start,
        'finishedAt': stamp(), 'commit': revision, 'workingTreeDirtyAfter': dirty,
        'exitCode': result.returncode, 'stdout': str(stdout.relative_to(ARTIFACT)),
        'stderr': str(stderr.relative_to(ARTIFACT)),
        'stdoutSha256': hashlib.sha256(stdout.read_bytes()).hexdigest(),
        'stderrSha256': hashlib.sha256(stderr.read_bytes()).hexdigest(),
    }, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'label': label, 'exitCode': result.returncode, 'commit': revision, 'dirtyAfter': dirty, 'run': str(target)}))
    if result.stdout: print(result.stdout)
    if result.stderr: print(result.stderr, file=sys.stderr)
    return result.returncode

if __name__ == '__main__':
    if len(sys.argv) < 4:
        raise SystemExit('label cwd argv... required')
    raise SystemExit(run(sys.argv[1], sys.argv[2], sys.argv[3:]))
