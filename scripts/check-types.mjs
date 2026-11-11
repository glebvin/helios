import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
const tsc = resolve('apps/api/node_modules/typescript/bin/tsc');
const commands = [
  ['-p','apps/api/tsconfig.json','--noEmit'],
  ['-p','apps/web/tsconfig.json','--noEmit'],
  // Existing domain package resolves Node declarations from API; no dependency change here.
  ['-p','packages/domain/tsconfig.json','--noEmit','--typeRoots','apps/api/node_modules/@types'],
  ['-p','packages/offline/tsconfig.json','--noEmit'],
];
for (const args of commands) {
  const result = spawnSync(process.execPath,[tsc,...args],{stdio:'inherit',env:process.env});
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
