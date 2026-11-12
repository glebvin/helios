import assert from 'node:assert/strict';
import test from 'node:test';
import { templateDraft, templateBody, templateValidation, qualificationCodes, templateError, type AdmissionTemplate } from './admission-template.ts';
const row: AdmissionTemplate = {projectId:'p',code:'base',title:'Допуск',version:3,items:[{id:'keep',label:'Инструктаж',critical:true}],requiredQualificationCodes:['safety']};
test('template update retains point identity and original version, omits immutable code',()=>{
 const draft=templateDraft(row);draft.items[0].label='  Новый инструктаж  ';draft.codes=' safety\r\n\n height ';
 const body=templateBody(draft,row,'request');assert.equal(body.expectedVersion,3);assert.equal('code' in body,false);
 assert.deepEqual(body.items,[{id:'keep',label:'Новый инструктаж',critical:true}]);assert.deepEqual(body.requiredQualificationCodes,['safety','height']);
 assert.equal(row.items[0].label,'Инструктаж','draft does not mutate source');
});
test('new template uses code and server creates first version',()=>{
 const draft=templateDraft(null);draft.code=' base ';draft.title='  Допуск ';draft.items[0].label='Паспорт';
 const body=templateBody(draft,null,'id');assert.equal(body.code,'base');assert.equal(body.title,'Допуск');assert.equal('expectedVersion' in body,false);assert.equal(templateValidation(draft),'');
});
test('yes/no template requires points and unique bounded qualification codes',()=>{
 const draft=templateDraft(row);draft.items=[];assert.match(templateValidation(draft),/один пункт/);
 draft.items=[{id:'q',label:'Проверка',critical:false}];draft.codes='safety\n safety';assert.match(templateValidation(draft),/повторяться/);
 draft.codes='x'.repeat(81);assert.match(templateValidation(draft),/80 символов/);draft.codes='';assert.equal(templateValidation(draft),'');
 assert.deepEqual(qualificationCodes('a,b\n c'),['a,b','c'],'only newline separates codes');
});
test('stale, permission and network errors never claim success',()=>{
 assert.match(templateError(409,'stale_version'),/другом окне/);assert.match(templateError(403),/недоступно/);assert.match(templateError(null),/Нет подтверждения/);
});
