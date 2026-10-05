"""Read back MC024 actual evidence, create case/coverage reports and seal review copies."""
import collections, datetime, hashlib, json, pathlib, re, shutil, subprocess

CHAT = pathlib.Path(__file__).resolve().parent.parent
ROOT = CHAT / 'work/growth-native-acceptance-9c69b8c'
BASE = ROOT / 'outputs/mine-clear/T-2026-1006-0002/independent-552f892'
ORIGINAL = CHAT / 'outputs/mine-clear/T-2026-1006-0002'
PREP = CHAT / 'work/native-mc024-preparation'
SOURCE = '552f892edd2d97f264c7bfc2d23c8c7db472ff91'
REPAIR = '5bee55d6a754462ca60cdf2a98bd9b1e6807193d'
AUDIT = 'c523e9e24300755a6f65c018712ad85c1005838d'
ACTOR = 'native-entry-independent-acceptance'

def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def load(path): return json.loads(path.read_text())
def stamp(): return datetime.datetime.now(datetime.timezone.utc).isoformat()
def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
def git(*args): return subprocess.check_output(['git', *args], cwd=ROOT)

def validate_ref(ref, root):
    p = root / ref['path']
    assert p.is_file() and not p.is_symlink() and sha(p) == ref['sha256'], str(p)
    return p

def historical_validate():
    results = []
    historical = BASE / 'historical/repair-origin'
    assert not historical.exists()
    seal = ORIGINAL / 'archive-manifest.json'
    data = load(seal)
    for item in data['files']:
        original = validate_ref(item, ORIGINAL)
        current = validate_ref(item, ROOT / 'outputs/mine-clear/T-2026-1006-0002')
        target = historical / item['path']; target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, target); assert sha(target) == item['sha256']
        results.append({'path': item['path'], 'sha256': item['sha256'], 'source_disk_matches_original': True})
    historical.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(seal, historical / seal.name)
    old_original = CHAT / 'outputs/native-prd-independent-c523e9e'
    old_current = ROOT / 'outputs/mine-clear/T-2026-1006-0001/independent-c523e9e'
    old_manifest = old_original / 'independent-archive-manifest.json'
    assert sha(old_manifest) == sha(old_current / old_manifest.name)
    old_data = load(old_manifest)
    for item in old_data['files']:
        validate_ref(item, old_original); validate_ref(item, old_current)
    assert len(old_data['files']) == 208
    old_manifest_copy = BASE / 'historical/MC023-original-manifest.json'
    shutil.copyfile(old_manifest, old_manifest_copy)
    result = {'schema': 'workloom.independent-mc024-historical-immutability/v1', 'grade': 'B',
        'mc024_repair_archive_manifest_sha256': sha(seal), 'mc024_repair_archive_files_including_manifest': len(results) + 1,
        'mc024_repair_source_commit': REPAIR, 'mc024_repair_files': results,
        'mc023_original_archive_path': str(old_original), 'mc023_current_source_archive_path': str(old_current),
        'mc023_manifest_sha256': sha(old_manifest), 'mc023_immutable_files_including_manifest': 209,
        'mc023_source_commit': AUDIT, 'old_execution_not_rerun_or_relabelled': True,
        'all_compared_original_bytes_equal': True}
    write(BASE / 'historical-immutability.json', result)
    return result

def current_validate():
    assert git('rev-parse', 'HEAD').decode().strip() == SOURCE
    assert not git('status', '--porcelain')
    identity = load(PREP / 'final-source-identity.json')
    assert identity['tracked_count'] == 5663
    for item in identity['trackedFiles']: assert sha(ROOT / item['path']) == item['sha256'], item['path']
    ready_path = CHAT / 'outputs/mine-clear/T-2026-1006-0002-finalization/FINAL_SOURCE_READY.json'
    ready = load(ready_path)
    assert ready['finalCommit'] == SOURCE and ready['testedSourceCommit'] == REPAIR
    assert ready['prerequisite'] == '9df590d909a0a66a7e7593c357466eebe083804a'
    for commit in [REPAIR, AUDIT, ready['prerequisite']]:
        subprocess.run(['git', 'merge-base', '--is-ancestor', commit, SOURCE], cwd=ROOT, check=True)
    unique = git('diff', '--name-only', ready['prerequisite'] + '..' + SOURCE).decode().splitlines()
    assert sorted(unique) == sorted(ready['uniqueModificationPathsRelativeToPrerequisite'])
    assert len(unique) == ready['uniqueModificationCountRelativeToPrerequisite'] == 133
    finalization = git('diff', '--name-only', REPAIR + '..' + SOURCE).decode().splitlines()
    assert sorted(finalization) == sorted(ready['docsOnlyFinalizationPaths'])
    assert len(finalization) == 335
    for item in ready['behaviorFileChecks']:
        assert sha(ROOT / item['path']) == item['sha256']
        previous = git('show', REPAIR + ':' + item['path'])
        assert hashlib.sha256(previous).hexdigest() == item['sha256']
    assert len(ready['behaviorFileChecks']) == 8
    for item in ready['standardNodeAssertions']:
        validate_ref(item['run'], ORIGINAL / 'repair-green')
        validate_ref(item['output'], ORIGINAL / 'repair-green')
    assert ready['sourceSealedManifestSha256'] == sha(ORIGINAL / 'archive-manifest.json')
    shutil.copyfile(ready_path, BASE / 'historical/repair-FINAL_SOURCE_READY.json')
    ledger = load(BASE / 'ledger.json'); card = ledger['cards'][0]
    assert len(ledger['cards']) == 1 and card['id'] == 'MC-024'
    assert card['state'] == 'verified' and card['verified_by'] == ACTOR
    assert card['fixed_by'] == '/root/mc024_facts_scoring_repair' and card['fixed_by'] != ACTOR
    assert ledger['baseline']['audit']['commit'] == AUDIT
    assert ledger['baseline']['repair']['commit'] == REPAIR
    assert ledger['baseline']['acceptance']['commit'] == SOURCE and ledger['baseline']['acceptance']['is_descendant_of_repair'] is True
    formal = []
    for i, assertion in enumerate(card['assertions']):
        run = load(validate_ref(assertion['run'], BASE))
        assert run['actor'] == ACTOR and run['role'] == 'acceptance' and run['commit'] == SOURCE
        assert run['result'] == 'pass' and run['exit_code'] == 0 and run['working_tree_dirty'] is False
        assert run['subject'] == {'card_id': 'MC-024', 'assertion_index': i}
        for ref in run['outputs']: validate_ref(ref, BASE)
        observer = run['node_observer']; summary_path = validate_ref(observer['summary'], BASE)
        assert pathlib.Path(observer['destination']).resolve() == summary_path.resolve()
        assert pathlib.Path(observer['reporter_path']).resolve() == (ROOT / 'scripts/delivery/node-test-reporter.mjs').resolve()
        assert sha(pathlib.Path(observer['reporter_path'])) == observer['reporter_sha256']
        assert run['requested_exec'] == assertion['exec']
        summary = load(summary_path); expected_count = [26, 30][i]
        assert summary['tests'] == summary['passed'] == expected_count and summary['success'] is True
        for key in ['failed', 'cancelled', 'skipped', 'todo']: assert summary[key] == 0
        assert summary['files'] == [1, 4][i]
        output = validate_ref(assertion['evidence'], BASE)
        formal.append({'run': assertion['run'], 'output': assertion['evidence'], 'summary': observer['summary'],
            'test_counts': run['validation']['testSummary'], 'raw_cases': re.findall(r'^ok \d+ - (.+)$', output.read_text(), re.M)})
        assert len(formal[-1]['raw_cases']) == expected_count
    vitest_path = BASE / 'narrow-producer-facts-authority-vitest.json'; vitest = load(vitest_path)
    assert vitest['success'] is True and vitest['numTotalTests'] == vitest['numPassedTests'] == 90
    assert vitest['numFailedTests'] == vitest['numPendingTests'] == vitest['numTodoTests'] == 0
    assert len(vitest['testResults']) == 3
    for suite in vitest['testResults']:
        assert pathlib.Path(suite['name']).is_relative_to(ROOT)
        assert all(item['status'] == 'passed' for item in suite['assertionResults'])
    ops = []
    for path in sorted((BASE / 'operations').glob('*.run.json')):
        op = load(path)
        assert op['exit_code'] == 0 and op['role'] == 'acceptance' and op['actor'] == ACTOR
        assert op['source_before'] == op['source_after'] == {'commit': SOURCE, 'working_tree_dirty': False}
        assert sha(BASE / op['stdout']) == op['stdout_sha256']
        assert sha(BASE / op['stderr']) == op['stderr_sha256']
        ops.append({'path': str(path.relative_to(BASE)), 'sha256': sha(path), 'exit_code': 0})
    assert len(ops) == 10
    for name in ['formal-independent-gate', 'formal-independent-posthandoff-gate']:
        assert load(BASE / 'operations' / (name + '.stdout.txt'))['ok'] is True
    handoff = load(BASE / 'handoff.json')
    assert handoff['environment_claim'] == 'local-preview' and handoff['acceptance_baseline'] == SOURCE
    assert len(handoff['closed_problems']) == 1 and not handoff['open_problems']
    write(BASE / 'independent-validation.json', {'schema': 'workloom.independent-mc024-readback/v1',
        'source_commit': SOURCE, 'grade': 'B', 'tracked_files_current_equals_full_git_blob_inventory': 5663,
        'finalization_only_document_archive_paths': 335, 'eight_behavior_file_hashes_match_repair_source': True,
        'original_red_green_source_and_observer_history_preserved': True,
        'formal_node_summary_counts': [26, 30], 'narrow_vitest_passed': 90,
        'all_test_failed_cancelled_skipped_todo': 0, 'actual_operations': ops,
        'actor_separation': True, 'baseline_alignment': True, 'original_operational_root': str(BASE),
        'performed_at': stamp()})
    return ledger, formal, vitest

def source_coverage():
    new = ['AGENTS.md', 'AGENTS.repo.md', 'WORKLOOM_PRODUCT_CONTEXT.md', 'docs/DEVELOPMENT-PROTOCOL.md',
        'docs/repairs/T-2026-1006-0001.md', 'docs/repairs/T-2026-1006-0002.md',
        'packages/video-studio/src/producer-gate.ts', 'packages/video-studio/src/producer-gate.test.ts',
        'packages/video-studio/src/source-restrictions.ts', 'packages/video-studio/src/shot-intent.ts',
        'apps/server/src/video/marketing-facts.ts', 'apps/server/src/video/marketing-extraction.ts',
        'apps/server/src/video/marketing-facts.test.ts', 'apps/server/src/video/marketing-authority.test.ts',
        'scripts/native-marketing-facts-scoring.test.mts', 'scripts/native-marketing-review.test.mts',
        'scripts/native-marketing-extraction.test.mts', 'scripts/native-marketing-dossier.test.mts',
        'scripts/native-source-restrictions.test.mts', 'scripts/delivery/mine-clear.mjs',
        'scripts/delivery/evidence.mjs', 'scripts/delivery/node-test-reporter.mjs', 'package.json',
        'packages/video-studio/package.json', 'packages/video-studio/tsconfig.json',
        'packages/industry-contract/package.json', 'packages/industry-contract/tsconfig.json',
        'packages/industry-contract/tsconfig.build.json', 'apps/server/package.json', 'apps/server/tsconfig.json',
        'apps/server/vitest.config.ts', 'tsconfig.base.json', 'pnpm-workspace.yaml']
    new += [str(p.relative_to(ROOT)) for p in sorted((ROOT / 'scripts/fixtures/marketing-facts-scoring').glob('*.json'))]
    histories = [CHAT / 'outputs/native-entry-independent-76d7e78/independent-source-coverage.json',
                 CHAT / 'outputs/native-prd-independent-c523e9e/independent-source-coverage.json']
    lookup = {}
    for file in histories:
        for item in load(file)['files']: lookup[item['file']] = (item, file)
    carried = load(CHAT / 'work/native-mc024-selected-carried-paths.json') + ['scripts/delivery/README.md']
    rows = []
    for name in sorted(set(new + carried + ['pnpm-lock.yaml', 'docs/MINE-CLEAR-DELIVERY-SPEC.md', 'docs/mine-clear/ledger.schema.json'])):
        file = ROOT / name; value = {'file': name, 'sha256': sha(file), 'lines': len(file.read_text().splitlines()), 'source_commit': SOURCE}
        if name in new:
            value.update({'grade': 'A', 'method': 'Complete semantic reading during this MC024 independent task, including resumed segments through EOF.', 'read_at_commit': SOURCE if name.startswith('docs/') else REPAIR})
        elif name in carried:
            previous, inventory = lookup[name]
            assert sha(file) == previous['sha256'], name
            value.update({'grade': previous['grade'], 'method': 'Own earlier A/C semantic grade carried only after current full file SHA256 equality. Current comparison is B; not a new full reading claim.',
                'previous_source_commit': previous['source_commit'], 'provenance_inventory': str(inventory),
                'provenance_inventory_sha256': sha(inventory), 'read_at_commit': previous.get('read_at_commit', previous['source_commit']),
                'current_comparison_grade': 'B', 'exact_bytes_unchanged': True})
            for field in ['read_ranges', 'regions', 'scope_cut_reason', 'reason']:
                if field in previous: value[field] = previous[field]
        else:
            value.update({'grade': 'B', 'method': 'Full byte identity / metadata parse only; not semantic reading.',
                'reason': 'Lock dependency metadata and declared schema/spec beyond the local executable contract; actual MCD enforcement fully read and executed.'})
        rows.append(value)
    counts = {'total': len(rows), **{g: sum(x['grade'] == g for x in rows) for g in 'ABCD'}}
    data = {'schema': 'workloom.independent-source-coverage/v1', 'source_commit': SOURCE,
        'scope': 'MC024 facts prompt patch, exact tests/fixtures, nearest facts/native dossier/producer dependencies and local executor/config/governance.',
        'counts': counts, 'new_complete_reads': len(new), 'carried_complete_reads': sum(x['grade'] == 'A' and x['file'] not in new for x in rows),
        'files': rows, 'partial_and_machine_list': [x for x in rows if x['grade'] != 'A'],
        'whole_repository_identity_grade': 'B', 'whole_repository_tracked_files': 5663,
        'count_scope': 'These explicit source/config files only. 5663 disk/Git byte checks are separate overlapping identity metadata, not whole repository semantic coverage.',
        'grade_definitions': {'A': 'Complete semantic source reading, with own unchanged-file historical provenance made explicit.',
            'B': 'Actual process observation / full byte metadata identity; never semantic or production-quality proof.',
            'C': 'Named historical source regions only, carried after exact full byte equality.', 'D': 'Inference or unverified live-model/media outcome.'},
        'exclusions': ['Unrelated workspace source, full vendor orchestrator and compatibility implementations outside cited C regions are not semantically audited in this MC024 card.',
            'Third-party installed dependency104-package closure is metadata B only; full copied store includes23 unresolved unused symlinks, explicitly listed.',
            'No real model/provider/customer media/PG/business service, film rendering or cloud release execution by this independent role.',
            'No rerun/relabel of prior MC022/MC023 wide suites; original209-file seal validated byte-for-byte separately.']}
    write(BASE / 'independent-source-coverage.json', data)
    for i, path in enumerate(histories):
        target = BASE / ('historical/own-prior-coverage-' + str(i + 1) + '.json'); shutil.copyfile(path, target)
    return data

def cases_create(formal, vitest):
    previous = load(ORIGINAL / 'test-cases.json'); lookup = {x['testName']: x for x in previous['cases']}
    cases = []; retained = ['id', 'dimension', 'preconditions', 'steps', 'expected', 'testName', 'source', 'sourceFiles']
    for index, run in enumerate(formal):
        for name in run['raw_cases']:
            old = lookup[name]; row = {k: old[k] for k in retained if k in old}
            row.update({'actual': 'passed', 'source_commit': SOURCE, 'actor': ACTOR, 'role': 'acceptance',
                'evidence_grade': 'B', 'run': run['run'], 'output': run['output'], 'machine_summary': run['summary'],
                'case_conditions_provenance': 'Same tests at repair source; conditions checked against full current byte-identical test definitions. Actual result from new independent552f execution.',
                'semantic_model_claim': False})
            row['preconditions'] = ['Independent clean full552f checkout; minimal environment; fixed responses independent of prompt keywords.'] + row.get('preconditions', [])[1:]
            cases.append(row)
    for suite in vitest['testResults']:
        source = str(pathlib.Path(suite['name']).relative_to(ROOT))
        for item in suite['assertionResults']:
            assert item['fullName'] in lookup
            old = lookup[item['fullName']]
            row = {'id': old['id'], 'testName': item['fullName'], 'dimension': 'nearest-regression',
                'preconditions': ['Independent clean552f source; fixed model HTTP replies; test-only temporary files and loopback HTTP source fixture.',
                    'Real local pinned ffmpeg/ffprobe creates the existing test lavfi fixture; no customer/provider media.'],
                'steps': ['Execute the unmodified declared test and its concrete assertions using the recorded owned Vitest CLI; all three selected files in one actual run, no name filters.',
                    'Exclude outputs/dist-payload archival copies before test collection.'],
                'expected': item['title'], 'actual': item['status'], 'source': source, 'source_commit': SOURCE,
                'actor': ACTOR, 'role': 'acceptance', 'evidence_grade': 'B', 'duration_ms': item['duration'],
                'actual_run': 'operations/narrow-producer-facts-authority-regression.run.json',
                'actual_run_sha256': sha(BASE / 'operations/narrow-producer-facts-authority-regression.run.json'),
                'actual_report': 'narrow-producer-facts-authority-vitest.json',
                'actual_report_sha256': sha(BASE / 'narrow-producer-facts-authority-vitest.json'), 'semantic_model_claim': False}
            cases.append(row)
    assert len(cases) == 146 and len({x['testName'] for x in cases}) == 146
    assert len({x['id'] for x in cases}) == 146 and all(x['actual'] == 'passed' for x in cases)
    def dimensions(name):
        tags = ['regression']
        if re.search('invalid|missing|failed|failure|empty|false|拒绝|非法|错误|删除|超|缺|不存在', name, re.I): tags += ['error-or-negative']
        if re.search('boundary|zero|boolean|85|84|96|101|empty|尾|单位|空|status|hash|SHA|model|型号', name, re.I): tags += ['boundary']
        if re.search('scope|tenant|foreign|permission|detached|授权|限制|篡改|scope|权限', name, re.I): tags += ['permission-or-authority']
        if re.search('concurrent|parallel|detached|await|并发|异步', name, re.I): tags += ['concurrency']
        if len(tags) == 1: tags += ['normal']
        return tags
    for case in cases: case['dimensions'] = dimensions(case['testName'])
    write(BASE / 'independent-test-cases.json', {'schema': 'workloom.independent-mc024-actual-case-table/v1',
        'source_commit': SOURCE, 'actor': ACTOR, 'role': 'acceptance', 'total_distinct_cases': 146,
        'passed': 146, 'failed': 0, 'cancelled': 0, 'skipped': 0, 'todo': 0,
        'formal_Node_cases': 56, 'narrow_Vitest_cases': 90,
        'dimension_labels_are_metadata_not_new_test_definitions': True, 'cases': cases})
    return cases

def environment_capture():
    target = BASE / 'environment'; target.mkdir(exist_ok=True)
    for path in PREP.glob('*.json'): shutil.copyfile(path, target / path.name)
    for name in ['native-mc024-prepare.py', 'native-mc024-independent-execution.py', 'native-mc024-independent-report.py']:
        shutil.copyfile(CHAT / 'work' / name, target / name)
    for name in ['mine-clear.mjs', 'evidence.mjs', 'node-test-reporter.mjs']:
        shutil.copyfile(ROOT / 'scripts/delivery' / name, target / name)
    store = load(PREP / 'dependency-store-link-audit.json'); selected = load(PREP / 'selected-transitive-dependency-closure.json')
    assert len(store['missing_links']) == 23 and len(store['foreign_links']) == 0
    for item in selected['packages']:
        p = ROOT / item['path']; assert p.is_dir() and p.resolve().is_relative_to(ROOT)
        assert sha(p / 'package.json') == item['package_json_sha256']
        for dep in item['resolved_dependencies']: assert pathlib.Path(dep['resolved']).exists() and pathlib.Path(dep['resolved']).is_relative_to(ROOT)
    assert len(selected['packages']) == 104
    write(BASE / 'independent-attempt-history.json', {'schema': 'workloom.independent-mc024-attempt-history/v1',
        'own_preparation_first_attempt': {'actual_exit_code': 1, 'formal_tests_started': False,
            'reason': 'Initial broad dependency-store audit saw23 unresolved unused symlinks; first failure receipt retained verbatim.',
            'evidence': 'environment/environment-link-audit-first-failure.json'},
        'own_preparation_recovery': {'selected_transitive_packages': 104, 'selected_required_dependencies_present': True,
            'full_store_unresolved_unused_links': 23, 'full_store_foreign_links': 0,
            'remote_install': False, 'parent_dependency_bytes_cloned_to_owned_tree': True,
            'prior_owned_wrappers_retained': True},
        'actual_selected_loader_and_vitest': load(BASE / 'execution-rebind.json'),
        'new_formal_acceptance_attempts': 1, 'new_narrow_vitest_attempts': 1,
        'new_formal_source_failures': 0, 'own_source_files_modified': False,
        'parent_environment_failure_history': 'historical/repair-origin/environment-attempt-history.json',
        'no_lost_parent_run_reconstructed': True})

def report_create(ledger, coverage, historical, formal, cases):
    counts = coverage['counts']
    receipt = {'schema': 'workloom.independent-acceptance-receipt/v1', 'card_id': 'MC-024',
        'task_id': 'T-2026-1006-0002', 'source_commit': SOURCE, 'audit_commit': AUDIT, 'repair_commit': REPAIR,
        'actor': ACTOR, 'role': 'acceptance', 'fixed_by': ledger['cards'][0]['fixed_by'],
        'status': '完全通过', 'scope': '本卡授权的本机预览结构与离线协议验收', 'environment': 'local-preview',
        'formal_tests': 56, 'narrow_vitest_tests': 90, 'distinct_cases': len(cases), 'case_execution_instances': len(cases),
        'all_current_case_fail_skip_cancel_todo': 0,
        'formal_runs': [{k: x[k] for k in ['run', 'output', 'summary', 'test_counts']} for x in formal],
        'current_build_typecheck_gate_handoff_postgate_exit_codes': [0, 0, 0, 0, 0, 0],
        'ledger': {'path': 'ledger.json', 'sha256': sha(BASE / 'ledger.json')},
        'handoff': {'path': 'handoff.json', 'sha256': sha(BASE / 'handoff.json')},
        'original_operational_root': str(BASE), 'coverage': counts,
        'fixture_historical_verdict': 'OriginalVID1015 approved=true/score76 remains denied at85; not rewritten.',
        'real_model_semantic_outcome': 'D: unknown, not executed by this role',
        'production_release_or_film_claim': False, 'completed_at': stamp()}
    write(BASE / 'independent-acceptance-receipt.json', receipt)
    text = f'''## 覆盖率声明

- 范围内文件总数：{counts['total']}；精读：{counts['A']}（本卡完整读取{coverage['new_complete_reads']}，自身旧精读字节相同继承{coverage['carried_complete_reads']}）；机检/脚本解析：{counts['B']}；抽样：{counts['C']}；未读：{counts['D']}。
- 逐项清单、旧阅读提交、完整SHA256和两个vendor裁剪区间见 [independent-source-coverage.json](independent-source-coverage.json)。大vendor编排器与兼容层仅继承明确相关区间的C级，未声称全文件精读；lock、schema和额外规范只作B级机检。
- 另对当前5663个受控文件逐项核对完整Git blob与磁盘字节，并在测试后再次核对完整SHA；这是B级身份检查，与上述语义阅读范围重叠，不能作为全仓理解度。

**本卡本机预览结构与离线协议验收：完全通过。** 当前源为 `{SOURCE}`，审计为 `{AUDIT}`，原修复绿为 `{REPAIR}`。独立actor为 `{ACTOR}`，修复者为 `/root/mc024_facts_scoring_repair`；标准MCD实际运行将MC-024从fixed进入verified，没有借用修复者运行或修改旧observer路径。环境档位是local-preview。

| 实际验证 | 当前结果 | 当前原始记录 |
|---|---|---|
| facts请求、完整原A3字节、诚实/虚假空值、否定/限制/数字冲突、85边界、非法结构/缺模型/归档失败及非facts环节 | 26/26通过，0跳过 | 两条正式断言之一及其TestsStream摘要 |
| 原事实评审、抽取、原生档案与来源限制；并发/脱离作用域/来源复读 | 30/30通过，0跳过 | 第二条正式断言及其TestsStream摘要 |
| 最近监制、逐叶子事实、来源与权限 | 90/90通过：producer40、authority33、facts17；0跳过 | narrow-producer-facts-authority-vitest.json |
| 自有industry-contract实际构建；video/server类型检查 | 三项均实际退出0 | operations完整argv、输出和前后源身份 |
| 标准gate→handoff→postgate | 三项均实际退出0；闭环1、未闭环0 | ledger.json、handoff.json及operations |

当前146个不同案例各执行一次，前置条件、步骤、预期、实际结果和当前源/运行摘要见 [independent-test-cases.json](independent-test-cases.json)。Node由受控reporter回读真实非零逐文件计数；Vitest三个文件在同一次运行实际执行，不将归档副本或被过滤的外层加载计为案例。

**A，源码规则：** `producer-gate.ts:522-530` 的强制facts文本区分主张支持关系与检索覆盖。诚实no_evidence仍要求模型复核完整原文、status/noEvidenceReason和限制，不预置分数或批准；虚假空值、无支持主张、否定/限定/型号/数字/单位冲突或限制弱化仍要求拒绝。默认/custom rubric都收到强制规则，其它阶段的规则保持。阈值、HTTP、归档、解析及批次的产品代码保持原行为；最小变动只在facts文本。

**B，实际执行与历史字节：** 正式当前26+30及近邻90均通过。原VID1015的完整A3review、request、response、extraction和judge-exchange字节保持，原true/76继续按85门槛拒绝；这些固定回包独立于提示词内容，不根据关键词补分。8个行为/测试/fixture文件与5bee完整字节相同；552f对5bee仅335项文档/封存变化。原修复档案124文件和MC023封存209文件逐原字节核对相同，复制保持旧源与原绝对observer路径。

**C，显式阅读裁剪：** vendor总编排器和vendor-compat只覆盖清单中的原生来源、PRD/G4/脚本装订相关区间；其它vendor制作、兼容、后期与宿主广域实现不形成此卡语义结论。本卡不复跑旧MC022/MC023宽套件；旧运行仅按原字节与原SHA保留。

**D，真实效果边界：** 新真实模型是否遵守评分域、会给何分尚未知。这些离线固定响应断言不能证明新语义裁决、人物真实同脸、美学、完整成片或签名发行。没有真实模型、供应商、客户媒体、PG、业务服务或远程写操作。既有测试临时loopbackHTTP只服务自有文本夹具，唯一媒体过程为当前已授权的lavfi测试视频本地ffmpeg/ffprobe及五时刻采样。

准备阶段初次广域依赖审计实际退出1，未启动正式验收；23个未使用旧store断链、0外部源链接保留在清单。恢复使用自有APFS克隆与104个已选传递依赖闭环，不宣称整个旧store完整。实际选用的loader、Vitest、compiler和编解码器路径/散列见execution-rebind.json；先前自身包wrapper原字节保留。当前正式断言和近邻回归各只有一次，均无失败。原修复者的缺动态文件、丢失首个0测试原run、89通过/1跳过后精准补跑等历史原文独立留存，没有制造丢失run或改为当前验收。

原始运行与文件身份在 [independent-validation.json](independent-validation.json) 回读；原操作根 `{BASE}` 仍保留。交付目录为原字节审阅副本，副本不算另一次执行，不能改写绝对observer destination来伪造副本门禁。

## 收尾报告

- 已完成：当前最终552f干净完整检出；必要完整读取及自身旧阅读字节继承；56正式独立断言、90近邻回归；本机自生成视频采样；行业合同构建和两类型检查；标准gate/handoff/postgate；146案例、三基线、角色分离、当前5663文件与历史档案核对；原字节封存。
- 未完成/未覆盖：本独立角色的授权范围均已完成。真实模型评分、原意图预生产、完整影片与生产发行属于协调会话后续实测，当前无结果；广域vendor实现按C级显式裁剪，旧store23无关断链保留B级清单。
- 自主追加事项及理由：选择自有已闭环loader/Vitest/TS真实路径，避免wrapper版本漂移；执行前排除outputs/dist-payload测试副本；复核原固定true/76拒绝和旧209文件不可变性；复制123+manifest修复档案作为历史审阅，保持来源职责边界。
- 采用的假设：原固定回包仅作离线协议反例，新的真实模型效果未知；当前完整源属于原修复和前置规范提交的后代；原素材/供应商/业务运行由协调者继续负责。
- 置信度：本卡离线请求合同、原裁决保持、来源/权限与本机结构高，依据A源码+B真实146案例及标准门禁；新真实模型与影片效果未验证，D。
- 建议复核：producer-gate的7条facts强制文本；原A3true/76字节保持和26条真实请求断言；当前独立actor、三基线及observer真实路径。

## 自检表

- [是] 覆盖了本独立卡全部授权范围，并逐项声明机检、C级裁剪与真实模型边界？
- [是] 自主完成依赖恢复、真实运行、封存，未把可完成事项推给用户或以不必要问句收尾？
- [是] 每项结论有源码/当前实际记录，A/B/C/D准确，历史与当前源分开？
- [是] 完整补丁、前后源身份、案例与原输出可逐行审查，失败历史保持可追踪？
'''
    (BASE / 'independent-acceptance-report.md').write_text(text)
    (BASE / 'ARCHIVE-NOTE.md').write_text('''# MC024 独立原字节审阅封存

此目录是552f892最终源的独立local-preview证据。当前146案例来自本卡实际56+90运行，原操作根在receipt中保持。仓内/聊天outputs/交付副本都不构成新的执行，不能改写历史或当前Node observer的绝对destination、reporter身份、源SHA或actor。

historical/repair-origin为修复角色123文件与manifest的原字节副本，源5bee；历史fixed与空acceptance原记录仍保留。原MC023209文件没有重复嵌套复制，只保存原manifest与逐字节验证位置。环境初次失败、旧store23无关断链和选用104传递依赖闭环分别保留。

新真实模型语义结果、原意图预生产、完整影片及生产发行尚未由本角色执行；本机协议与结构通过不升级这些范围。
''')
    return receipt

def seal():
    assert not git('status', '--porcelain')
    items = [{'path': str(p.relative_to(BASE)), 'bytes': p.stat().st_size, 'sha256': sha(p)}
        for p in sorted(BASE.rglob('*')) if p.is_file()]
    manifest = {'schema': 'workloom.independent-archive-manifest/v1', 'source_commit': SOURCE, 'actor': ACTOR,
        'created_at': stamp(), 'self_excluded': 'independent-archive-manifest.json', 'file_count': len(items), 'files': items,
        'explanation': 'Current self excluded; nested historical manifests included. Absolute original observer paths are intentionally preserved.'}
    write(BASE / 'independent-archive-manifest.json', manifest)
    copies = [CHAT / 'outputs/mine-clear/T-2026-1006-0002/independent-552f892', CHAT / 'outputs/native-facts-independent-552f892']
    for copy in copies:
        assert not copy.exists(), str(copy)
        copy.parent.mkdir(parents=True, exist_ok=True)
        result = subprocess.run(['/bin/cp', '-cR', str(BASE), str(copy)], capture_output=True)
        assert result.returncode == 0, result.stderr.decode()
        for item in items: validate_ref(item, copy)
        assert sha(copy / 'independent-archive-manifest.json') == sha(BASE / 'independent-archive-manifest.json')
        assert len([p for p in copy.rglob('*') if p.is_file()]) == len(items) + 1
    result = {'schema': 'workloom.independent-mc024-archive-copy-validation/v1', 'source_commit': SOURCE,
        'actor': ACTOR, 'grade': 'B', 'original_root': str(BASE), 'review_copy_roots': [str(x) for x in copies],
        'manifest_sha256': sha(BASE / 'independent-archive-manifest.json'), 'files_including_manifest': len(items) + 1,
        'receipt_sha256': sha(BASE / 'independent-acceptance-receipt.json'),
        'all_three_copies_byte_equal': True, 'source_clean': not bool(git('status', '--porcelain')),
        'copies_are_not_new_executions': True, 'validated_at': stamp()}
    write(CHAT / 'outputs/native-facts-independent-552f892-validation.json', result)
    print(json.dumps(result, ensure_ascii=False, indent=2))

def main():
    historical = historical_validate()
    ledger, formal, vitest = current_validate()
    coverage = source_coverage(); cases = cases_create(formal, vitest)
    environment_capture(); report_create(ledger, coverage, historical, formal, cases); seal()

if __name__ == '__main__': main()
