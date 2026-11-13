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
    'docs/qa/repository-setup-2026-11-11.md']]
paths += sorted((root / 'docs/roadmap/steps').glob('R*.md'))
errors=[]
for path in paths:
    if not path.exists():
        errors.append(f'Missing {path.relative_to(root)}')
        continue
    text=path.read_text()
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
if errors:
    print('\n'.join(errors))
    sys.exit(1)
print(f'Document links and {len(steps)} roadmap cards checked')
