import assert from 'node:assert/strict';
import test from 'node:test';
import { blankAnswers, answersComplete, checkBody, checkReason, checkError } from './admission-check.ts';
import type { AdmissionTemplate } from './admission-template.ts';
const template: AdmissionTemplate = {projectId:'p',code:'site',title:'Допуск',version:2,items:[{id:'a',label:'Инструктаж',critical:true},{id:'b',label:'СИЗ',critical:false}],requiredQualificationCodes:['safety']};
test('every answer must be explicit; false is a complete answer, not absence',()=>{
 const answers=blankAnswers(template);assert.equal(answersComplete(template,answers),false);answers.a=false;assert.equal(answersComplete(template,answers),false);answers.b=true;assert.equal(answersComplete(template,answers),true);
});
test('check command binds exact template and answers, never sends client pass/time/reasons',()=>{
 const body=checkBody('p',template,{a:false,b:true},'receipt');assert.deepEqual(body,{requestId:'receipt',projectId:'p',templateVersion:2,answers:[{itemId:'a',value:false},{itemId:'b',value:true}]});assert.throws(()=>checkBody('p',template,{a:null,b:true},'id'),/answer_required/);
});
test('server reasons use immutable snapshot labels and never imply current admission',()=>{
 assert.equal(checkReason('critical_failed:a',template),'Ответ «нет» на критичный пункт: Инструктаж');assert.match(checkReason('qualification_expired:safety',template),/Срок квалификации истёк: safety/);assert.match(checkReason('noncritical_failed:b',template),/СИЗ/);
});
test('changed template and permission errors differ from unconfirmed network result',()=>{
 assert.match(checkError(409,'template_changed'),/заново/);assert.match(checkError(403),/недоступна/);assert.match(checkError(null),/Нет подтверждения/);
});
