import test from 'node:test';
import assert from 'node:assert/strict';
import { qualificationState, qualificationError, type Qualification } from './qualifications.ts';
const row: Qualification = {id:'q',employeeId:'e',code:'safety',title:'Охрана труда',documentReference:null,validUntil:'2026-11-11',status:'active',version:1};
test('qualification expiry is inclusive and uses supplied tenant day',()=>{
 assert.equal(qualificationState(row,'2026-11-11'),'Действует');
 assert.equal(qualificationState(row,'2026-11-12'),'Истекла');
 assert.equal(qualificationState({...row,status:'revoked'},'2026-11-10'),'Отозвана');
 assert.equal(qualificationState({...row,validUntil:null},'2099-12-31'),'Действует');
 assert.equal(qualificationState(row,''),'Срок не проверен');
});
test('qualification failures distinguish stale version, duplicate and access',()=>{
 assert.match(qualificationError({status:409,message:'stale_version'}),/Прочитайте актуальную/);
 assert.match(qualificationError({status:409,message:'conflict'}),/кодом/);
 assert.match(qualificationError({status:404}),/недоступны/);
 assert.match(qualificationError({}),/Нет подтверждения/);
});
