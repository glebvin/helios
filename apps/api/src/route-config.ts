import {httpError} from './errors.js';
import {uuid} from './api-input.js';

// Business roles from TZ v1.0 §5.3 are requirements, not administrator-granted permissions.
export const routeDefinitions = [
  {code:'daily-task',title:'Дневное задание',prepare:['master'],responsible:'director',review:[],approve:'director',observe:[],data:['pto','supply'],external:[]},
  {code:'front-readiness',title:'Готовность фронта',prepare:['master'],responsible:'director',review:[],approve:null,observe:['safety'],data:['pto','supply'],external:[]},
  {code:'employee-admission',title:'Допуск работника',prepare:['master'],responsible:'director',review:['safety'],approve:'director',observe:[],data:['hr'],external:[]},
  {code:'internal-inspection',title:'Сдача нашему СК',prepare:['master'],responsible:'director',review:[],approve:'pto',observe:['zds-sso'],data:[],external:[]},
  {code:'external-inspection',title:'Сдача внешнему СК',prepare:['master'],responsible:'director',review:[],approve:null,observe:['pto'],data:[],external:['РП и внешний СК — бумажные подписи с полномочием']},
  {code:'inspection-correction',title:'Устранение замечаний СК',prepare:['master'],responsible:'director',review:[],approve:null,observe:['zds-sso','pto'],data:[],external:['Внешний СК — бумажная подпись']},
  {code:'incoming-materials',title:'Входной контроль материалов',prepare:['master','supply'],responsible:'director',review:['pto'],approve:null,observe:[],data:['supply'],external:[]},
  {code:'hidden-works-act',title:'АОСР/АООК',prepare:['master'],responsible:'director',review:[],approve:null,observe:[],data:[],external:['РП, ПТО, заказчик объекта — бумажные подписи с полномочием']},
  {code:'documentation-register',title:'Реестр ИД',prepare:['engineer-pto'],responsible:'pto',review:[],approve:null,observe:['zds-soso'],data:[],external:[]},
  {code:'day-close',title:'Закрытие дня',prepare:['master'],responsible:'director',review:[],approve:null,observe:['hr'],data:[],external:[]},
  {code:'consolidated-timesheet',title:'Сводный табель',prepare:['hr'],responsible:'hr',review:[],approve:'hr',observe:[],data:['director'],external:[]},
  {code:'inspection-template',title:'Шаблоны сдачи',prepare:['engineer-pto'],responsible:'pto',review:['director','safety'],approve:'zds-soso',observe:[],data:[],external:[]},
  {code:'documentation-list',title:'Перечень ИД',prepare:['engineer-pto'],responsible:'pto',review:['director'],approve:'zds-soso',observe:[],data:[],external:['Внешнее утверждение заказчика вне системы']},
  {code:'ks2-readiness',title:'Сводка «не готово к КС-2»',prepare:[],responsible:'pto',review:[],approve:null,observe:['ds','gd'],data:['cost'],external:[]},
] as const;
export type RouteAssignment = {role:string;userId:string|null};
export type RouteConfiguration = {schemaVersion:1;routes:{documentType:string;preparers:RouteAssignment[];responsibles:RouteAssignment[];reviewers:RouteAssignment[];approvers:RouteAssignment[];observers:RouteAssignment[];dataProviders:RouteAssignment[]}[]};
const slots = ['preparers','responsibles','reviewers','approvers','observers','dataProviders'] as const;
const rolesFor=(d:typeof routeDefinitions[number])=>({preparers:[...d.prepare],responsibles:[d.responsible],reviewers:[...d.review],approvers:d.approve?[d.approve]:[],observers:[...d.observe],dataProviders:[...d.data]});
export function defaultRouteConfiguration():RouteConfiguration {
  return {schemaVersion:1,routes:routeDefinitions.map(d=>({documentType:d.code,...Object.fromEntries(Object.entries(rolesFor(d)).map(([key,roles])=>[key,roles.map(role=>({role,userId:null}))]))} as RouteConfiguration['routes'][number]))};
}
function object(value:unknown,keys:readonly string[]):Record<string,any> {
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k))||keys.some(k=>!Object.hasOwn(value,k)))throw httpError(400,'invalid_route_config');
  return value as Record<string,any>;
}
export function routeConfiguration(input:unknown):RouteConfiguration {
  const b=object(input,['schemaVersion','routes']);
  if(b.schemaVersion!==1||!Array.isArray(b.routes)||b.routes.length!==routeDefinitions.length)throw httpError(400,'invalid_route_config');
  const seen=new Set<string>();
  const routes=b.routes.map((value:unknown)=>{
    const row=object(value,['documentType',...slots]);
    const definition=routeDefinitions.find(d=>d.code===row.documentType);
    if(!definition||seen.has(row.documentType))throw httpError(400,'invalid_route_config');seen.add(row.documentType);
    const expected=rolesFor(definition);
    // Check cardinality before the business matrix, including invalid fourth C/second U.
    if(!Array.isArray(row.responsibles)||row.responsibles.length!==1||!Array.isArray(row.reviewers)||row.reviewers.length>3||!Array.isArray(row.approvers)||row.approvers.length>1)throw httpError(400,'invalid_route_config');
    const result:any={documentType:definition.code};
    for(const key of slots){
      if(key==='reviewers'){
        const allowed:string[]=[...definition.review];
        const used=new Set<string>();
        result.reviewers=row.reviewers.map((value:unknown)=>{
          const item=object(value,['role','userId']);
          if(!allowed.includes(item.role))throw httpError(400,'route_roles_required');
          const userId=item.userId===null?null:uuid(item.userId).toLowerCase();
          const identity=userId??`unassigned:${item.role}`;
          if(used.has(identity))throw httpError(400,'invalid_route_config');used.add(identity);
          return {role:item.role,userId};
        }).sort((a:RouteAssignment,b:RouteAssignment)=>a.role.localeCompare(b.role)||(a.userId??'').localeCompare(b.userId??''));
        if(allowed.some(role=>!result.reviewers.some((item:RouteAssignment)=>item.role===role)))throw httpError(400,'route_roles_required');
        continue;
      }
      if(!Array.isArray(row[key])||row[key].length!==expected[key].length)throw httpError(400,'route_roles_required');
      const assigned=new Set<string>();
      result[key]=expected[key].map(role=>{
        const candidates=row[key].filter((v:unknown)=>object(v,['role','userId']).role===role);
        if(candidates.length!==1)throw httpError(400,'route_roles_required');
        const item=candidates[0];
        const userId=item.userId===null?null:uuid(item.userId).toLowerCase();
        if(userId&&assigned.has(userId))throw httpError(400,'invalid_route_config');
        if(userId)assigned.add(userId);
        return {role,userId};
      });
    }
    return result;
  });
  return {schemaVersion:1,routes:routeDefinitions.map(d=>routes.find((r:any)=>r.documentType===d.code)!)};
}
export function routeConfigCommand(input:unknown){
  const b=object(input,['requestId','expectedVersion','configuration']);
  const requestId=uuid(b.requestId);
  if(!Number.isSafeInteger(b.expectedVersion)||b.expectedVersion<0||b.expectedVersion>=2147483647)throw httpError(400,'invalid_version');
  return {requestId,expectedVersion:b.expectedVersion as number,configuration:routeConfiguration(b.configuration)};
}
