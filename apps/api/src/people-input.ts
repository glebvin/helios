import { day, uuid } from './api-input.js';
import { httpError } from './errors.js';

export function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !keys.includes(k))) throw httpError(400, 'invalid_body');
  return value as Record<string, unknown>;
}
export function text(value: unknown, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw httpError(400, 'invalid_text');
  return value.trim();
}
function nullableText(value: unknown) { return value === null ? null : text(value, 500); }
function nullableId(value: unknown) { return value === null ? null : uuid(value).toLowerCase(); }
export function integer(value: unknown, min = 1): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > 2147483646) throw httpError(400, 'invalid_version');
  return value as number;
}
export function status(value: unknown, terminal: string) {
  if (value !== 'active' && value !== terminal) throw httpError(400, 'invalid_status');
  return value as string;
}
export function employeeInput(value: unknown, update = false) {
  const b = object(value, ['requestId','fullName','organizationId','phone','userId', ...(update ? ['expectedVersion','status'] : [])]);
  return { requestId: uuid(b.requestId).toLowerCase(), fullName: text(b.fullName), organizationId: uuid(b.organizationId).toLowerCase(),
    phone: !update && b.phone === undefined ? null : nullableText(b.phone), userId: !update && b.userId === undefined ? null : nullableId(b.userId),
    ...(update ? { expectedVersion: integer(b.expectedVersion), status: status(b.status, 'archived') } : {}) };
}
export function qualificationInput(value: unknown, update = false) {
  const b = object(value, ['requestId','title','documentReference','validUntil', ...(update ? ['expectedVersion','status'] : ['code'])]);
  if (update && (b.validUntil === undefined || b.documentReference === undefined)) throw httpError(400, 'invalid_body');
  return { requestId: uuid(b.requestId).toLowerCase(), title: text(b.title),
    documentReference: b.documentReference === undefined && !update ? null : nullableText(b.documentReference),
    validUntil: b.validUntil === null || (!update && b.validUntil === undefined) ? null : day(b.validUntil)!,
    ...(update ? { expectedVersion: integer(b.expectedVersion), status: status(b.status,'revoked') } : { code: text(b.code,80) }) };
}
function array(value: unknown, min = 0): unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > 100) throw httpError(400,'invalid_array');
  return value;
}
function unique(values: string[]) { if(new Set(values).size!==values.length) throw httpError(400,'duplicate_item'); }
function boolean(value: unknown): boolean { if(typeof value!=='boolean') throw httpError(400,'invalid_boolean');return value; }
export function templateInput(value: unknown,update=false) {
  const b=object(value,['requestId','title','items','requiredQualificationCodes',update?'expectedVersion':'code']);
  const items=array(b.items,1).map(value=>{const i=object(value,['id','label','critical']);return {id:text(i.id,80),label:text(i.label,500),critical:boolean(i.critical)};});
  const requiredQualificationCodes=array(b.requiredQualificationCodes).map(c=>text(c,80));
  unique(items.map(i=>i.id));unique(requiredQualificationCodes);
  return {requestId:uuid(b.requestId).toLowerCase(),title:text(b.title),items,requiredQualificationCodes,...(update?{expectedVersion:integer(b.expectedVersion)}:{code:text(b.code,80)})};
}
export function checkInput(value:unknown) {
  const b=object(value,['requestId','projectId','templateVersion','answers']);
  const answers=array(b.answers,1).map(value=>{const i=object(value,['itemId','value']);return {itemId:text(i.itemId,80),value:boolean(i.value)};});
  unique(answers.map(i=>i.itemId));
  return {requestId:uuid(b.requestId).toLowerCase(),projectId:uuid(b.projectId).toLowerCase(),templateVersion:integer(b.templateVersion),answers};
}
export function membershipInput(value:unknown,assignment=false) {
  const b=object(value,['requestId','expectedVersion','status',...(assignment?['admissionCheckId']:[])]);
  const s=status(b.status,'revoked');
  if(assignment && s==='revoked' && b.admissionCheckId!==undefined) throw httpError(400,'invalid_body');
  return {requestId:uuid(b.requestId).toLowerCase(),expectedVersion:integer(b.expectedVersion,0),status:s,
    ...(assignment && s==='active'?{admissionCheckId:uuid(b.admissionCheckId).toLowerCase()}: {})};
}
export function crewInput(value:unknown) {const b=object(value,['requestId','name']);return {requestId:uuid(b.requestId).toLowerCase(),name:text(b.name)};}
