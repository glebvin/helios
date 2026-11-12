import assert from 'node:assert/strict';
import test from 'node:test';
import { accessCommand, storedAccessCommand, accessError } from './project-access.ts';
test('revocation omits stale admission check, activation binds the chosen check and version', () => {
 assert.deepEqual(accessCommand(4,'revoked','receipt','old-check'),{requestId:'receipt',expectedVersion:4,status:'revoked'});
 assert.deepEqual(accessCommand(0,'active','receipt','latest'),{requestId:'receipt',expectedVersion:0,status:'active',admissionCheckId:'latest'});
});
test('unconfirmed command survives reload with original operation and expected version', () => {
 const command=accessCommand(2,'active','receipt','latest');
 assert.deepEqual(storedAccessCommand(JSON.stringify(command)),command);
 for(const bad of ['{','null','{}','{"requestId":"id","expectedVersion":-1,"status":"active"}','{"requestId":"id","expectedVersion":2,"status":"deleted"}']) assert.equal(storedAccessCommand(bad),null);
});
test('server admission, conflict and unknown delivery have distinct recovery guidance', () => {
 assert.match(accessError(422,'admission_required'),/новую проверку/);
 assert.match(accessError(409,'stale_version'),/другом окне/);
 assert.match(accessError(null),/ту же команду/);
});
