// Validate the emitted workspace exports with the actual production installation.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readFile} from 'node:fs/promises';
const root=resolve(process.argv[2]??'.data/staging-runtime');
const source=JSON.parse(await readFile('apps/api/package.json','utf8'));
const emitted=JSON.parse(await readFile(resolve(root,'apps/api/package.json'),'utf8'));
assert.deepEqual(Object.keys(emitted.exports).sort(),Object.keys(source.exports).sort());
const worker=createRequire(resolve(root,'apps/worker/src/main.js'));
for(const key of Object.keys(source.exports)){
 const file=worker.resolve('@helios/api'+key.slice(1));assert.ok(file.endsWith('.js'));
 await import(pathToFileURL(file).href);
}
await import(pathToFileURL(resolve(root,'apps/api/src/app.module.js')).href);
assert.equal(worker('multer/package.json').version,'2.5.0');
console.log('Compiled API graph, worker exports and patched production dependencies: passed');
