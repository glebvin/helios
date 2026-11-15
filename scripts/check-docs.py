"""Check repository-owned entry documents and roadmap links, not historical notes."""
from pathlib import Path
import json, re, sys, urllib.parse

root = Path(__file__).resolve().parent.parent
paths = [root / p for p in [
    'README.md','NEXT.md','AGENTS.md','CONTRIBUTING.md','SECURITY.md',
    'docs/ROADMAP.md','docs/GITHUB-FOR-OWNER.md','docs/ROLE-FLOW-MAP.md',
    'docs/DEVELOPMENT.md','docs/DEFINITION-OF-DONE.md','docs/BRANCHES-AND-RELEASES.md',
    'docs/roadmap/PILOT-19.2.md',
    '.github/pull_request_template.md','docs/PR-HANDOFF.md',
    'docs/qa/retrospective-handoff-2026-11-13.md','docs/test-cases/README.md',
    'docs/qa/offline-release-r23-r25.md',
    'docs/qa/repository-setup-2026-11-11.md']]
paths += sorted((root / 'docs/roadmap/steps').glob('R*.md'))
paths += sorted((root / 'docs/requirements').glob('*.md'))
errors=[]
for path in paths:
    if not path.exists():
        errors.append(f'Missing {path.relative_to(root)}')
        continue
    text=path.read_text()
    if re.search(r"^(?:<{7} |>{7} )", text, re.M):
        errors.append(f'Unresolved merge conflict in {path.relative_to(root)}')
    for target in re.findall(r'(?<!!)\[[^\]]+\]\(([^)]+)\)',text):
        target=target.strip('<>').split('#',1)[0]
        if not target or re.match(r'^[a-zA-Z][a-zA-Z0-9+.-]*:',target):
            continue
        target=urllib.parse.unquote(target)
        if target.startswith('/'):
            errors.append(f'Non-portable absolute link in {path.relative_to(root)}')
        elif not (path.parent / target).resolve().exists():
            errors.append(f'Broken link in {path.relative_to(root)}: {target}')
steps=json.loads((root/'docs/roadmap/steps.json').read_text())
ids={s['id'] for s in steps}
if len(ids)!=len(steps): errors.append('Duplicate roadmap step IDs')
for s in steps:
    card=root / f"docs/roadmap/steps/{s['id']}-{s['slug']}.md"
    if not card.exists(): errors.append(f'Missing card {s["id"]}')
    for field in ('source', 'coverage'):
        if not s.get(field, '').strip(): errors.append(f'Missing TZ {field} in {s["id"]}')
    if card.exists() and '## Связь с ТЗ заказчика' not in card.read_text():
        errors.append(f'Missing visible TZ reference in {s["id"]}')
    if s.get('source_version') != '1.0' or not s.get('legacy_source_4_0'):
        errors.append(f'Missing current TZ version or historical reference in {s["id"]}')
    if card.exists() and f'Источник: **ТЗ v1.0 {s["source"]}**' not in card.read_text():
        errors.append(f'Card/metadata TZ source drift in {s["id"]}')
    if not s.get('v1_note') or (card.exists() and s['v1_note'] not in card.read_text()):
        errors.append(f'Card/metadata v1 requirement drift in {s["id"]}')
    if s['depends']!='—':
        for dep in s['depends'].split(','):
            if 'R'+dep not in ids: errors.append(f'Unknown dependency {dep}')
# An otherwise valid list of dependency IDs can still deadlock delivery.
graph={s['id']:[] if s['depends']=='—' else ['R'+d for d in s['depends'].split(',')] for s in steps}
visited, active=set(), set()
def visit(node):
    if node in active:
        errors.append(f'Cyclic roadmap dependency at {node}')
        return
    if node in visited or node not in graph: return
    active.add(node)
    for dependency in graph[node]: visit(dependency)
    active.remove(node)
    visited.add(node)
for node in graph: visit(node)
mapping=json.loads((root/'docs/roadmap/github-issues.json').read_text())
if {i['step'] for i in mapping}!=ids or len(mapping)!=len(ids):
    errors.append('GitHub mapping must cover each existing roadmap card exactly once')
coverage=(root/'docs/roadmap/PILOT-19.2.md').read_text()
for n in range(1,11):
    if f'| 19.2.{n} |' not in coverage: errors.append(f'Missing pilot coverage row 19.2.{n}')
trace=(root/'docs/requirements/EXECUTION-v1.md').read_text()
tests=re.findall(r'^\| (T-\d{2}) \|',trace,re.M)
if sorted(tests)!=[f'T-{n:02}' for n in range(1,25)]:
    errors.append('Current TZ must trace T-01 through T-24 exactly once')
decisions=re.findall(r'^\| (D-\d{2}) \|',(root/'docs/requirements/TZ-v1-baseline.md').read_text(),re.M)
if sorted(decisions)!=[f'D-{n:02}' for n in range(1,7)]:
    errors.append('Owner decisions D-01 through D-06 must remain traceable')
if errors:
    print('\n'.join(errors))
    sys.exit(1)
print(f'Document links and {len(steps)} roadmap cards checked')
