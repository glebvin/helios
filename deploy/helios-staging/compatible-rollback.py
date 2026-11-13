#!/usr/bin/env python3
"""Keep a previous app/UI while retaining dual password reading and patched runtime dependencies.
Inputs must be compiled, secret-free build contexts, never a live deployment directory.
"""
import argparse, hashlib, json, shutil
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--previous',required=True,type=Path);p.add_argument('--candidate',required=True,type=Path);p.add_argument('--out',required=True,type=Path);a=p.parse_args()
for root in (a.previous,a.candidate):
 assert (root/'release.json').is_file()
 assert not list(root.rglob('.env')) and not list(root.rglob('node_modules'))
assert not a.out.exists(), 'Output must be a new immutable context'
previous=json.loads((a.previous/'release.json').read_text());candidate=json.loads((a.candidate/'release.json').read_text())
# Application schema must be identical; rollback never restores the business database.
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def sql(root):return {str(f.relative_to(root)):digest(f) for f in sorted((root/'apps/api/sql').rglob('*.sql'))}
assert sql(a.previous)==sql(a.candidate), 'Schema differs: review rollback separately'
shutil.copytree(a.previous,a.out)
files=['apps/api/src/password.js','apps/api/src/auth.service.js','apps/api/src/invitations.service.js','package.json','package-lock.json','Dockerfile','compose.yaml']
for name in files:shutil.copy2(a.candidate/name,a.out/name)
manifest={**previous,'kind':'password-compatible-rollback','authenticationPatch':candidate['commit'],'retainedFiles':{name:digest(a.out/name) for name in files}}
(a.out/'rollback.json').write_text(json.dumps(manifest,indent=2)+'\n')
print(json.dumps({'previous':previous['commit'],'authenticationPatch':candidate['commit'],'overlaidFiles':len(files),'schemaUnchanged':True}))
