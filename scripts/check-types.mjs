import {spawn} from 'node:child_process';
import {resolve} from 'node:path';
import {performance} from 'node:perf_hooks';

const tsc = resolve('apps/api/node_modules/typescript/bin/tsc');
const commands = [
  ['api', ['-p','apps/api/tsconfig.json','--noEmit']],
  ['web', ['-p','apps/web/tsconfig.json','--noEmit']],
  // Existing domain package resolves Node declarations from API; no dependency change here.
  ['domain', ['-p','packages/domain/tsconfig.json','--noEmit','--typeRoots','apps/api/node_modules/@types']],
  ['offline', ['-p','packages/offline/tsconfig.json','--noEmit']],
];
const parallel = Number(process.env.HELIOS_TYPECHECK_CONCURRENCY ?? 2);
if (!Number.isInteger(parallel) || parallel < 1 || parallel > commands.length) {
  console.error('HELIOS_TYPECHECK_CONCURRENCY must be an integer from1 to4');
  process.exit(1);
}
let position = 0;
let failed = false;
async function worker() {
  while (position < commands.length) {
    const [name, args] = commands[position++];
    const started = performance.now();
    const result = await new Promise(resolve => {
      const child = spawn(process.execPath, [tsc, ...args], {env:process.env, stdio:['ignore','pipe','pipe']});
      let output = '';
      child.stdout.on('data', bytes => { output += bytes; });
      child.stderr.on('data', bytes => { output += bytes; });
      child.on('error', error => resolve({code:1, output:output + error.message}));
      child.on('close', code => resolve({code:code ?? 1, output}));
    });
    if (result.output) process.stdout.write(`[TypeScript ${name}]\n${result.output}`);
    console.log(`TypeScript ${name}: ${result.code === 0 ? 'passed' : 'FAILED'} (${((performance.now()-started)/1000).toFixed(2)}s)`);
    if (result.code !== 0) failed = true;
  }
}
// Each compiler has --noEmit and no shared output; database suites remain sequential.
await Promise.all(Array.from({length:parallel}, worker));
if (failed) process.exitCode = 1;
