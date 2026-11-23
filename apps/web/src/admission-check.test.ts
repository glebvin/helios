import assert from 'node:assert/strict';
import test from 'node:test';
import { blankAnswers, answersComplete, checkBody, checkReason, checkError, reviewLine, approvalLine } from './admission-check.ts';
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
test('safety agreement is unnamed until the route names a reviewer',()=>{
 assert.equal(reviewLine(null,'director'),'');
 assert.equal(reviewLine({recorded:false,required:true,recordedAt:null},'director'),'Охрана труда ещё не согласовала эту попытку.');
 assert.equal(reviewLine({recorded:false,required:true,recordedAt:null},'safety'),'');
 assert.equal(reviewLine({recorded:true,required:true,recordedAt:'2026-11-22T12:00:00.000Z'},'master'),'Охрана труда согласовала эту попытку.');
});
test('director approval is unnamed until the route names an approver',()=>{
 assert.equal(approvalLine(null,'safety'),'');
 assert.equal(approvalLine({recorded:false,required:true,recordedAt:null},'safety'),'Руководитель ещё не утвердил эту попытку.');
 assert.equal(approvalLine({recorded:false,required:true,recordedAt:null},'director'),'');
 assert.equal(approvalLine({recorded:true,required:true,recordedAt:'2026-11-22T12:00:00.000Z'},'master'),'Руководитель утвердил эту попытку.');
});
test('changed template and permission errors differ from unconfirmed network result',()=>{
 assert.match(checkError(409,'template_changed'),/заново/);assert.match(checkError(403),/недоступна/);assert.match(checkError(null),/Нет подтверждения/);
});
