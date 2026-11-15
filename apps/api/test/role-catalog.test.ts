import assert from 'node:assert/strict';
import test from 'node:test';
import type {ExecutionContext} from '@nestjs/common';
import {isKnownRole, isExistingRuntimeRole, roleCatalog, roleDescriptor} from '../src/role-catalog.js';
import {roleContractAllows, type AuthorizedScope, type ResourceScope, type ContractPermission} from '../src/role-permissions.js';
import {TenantGuard, type AuthService} from '../src/auth.service.js';

const tenant='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222';
const project='33333333-3333-4333-8333-333333333333', employer='44444444-4444-4444-8444-444444444444';
const employee='55555555-5555-4555-8555-555555555555', crew='66666666-6666-4666-8666-666666666666';
const actor=(role:string):AuthorizedScope=>({role,tenantId:tenant,projectIds:[project],employerIds:[employer],employeeId:employee,crewIds:[crew]});
const resource:ResourceScope={tenantId:tenant,projectId:project,employerId:employer,employeeId:employee,crewId:crew};
const allow=(role:string,permission:ContractPermission,target=resource)=>roleContractAllows(actor(role),permission,target);

test('catalog preserves13 existing codes and reserves7 new codes without role aliases',()=>{
  assert.equal(roleCatalog.length,20);assert.equal(new Set(roleCatalog.map(r=>r.code)).size,20);
  assert.equal(roleCatalog.filter(r=>r.runtime==='existing').length,13);
  assert.equal(roleCatalog.filter(r=>r.runtime==='reserved').length,7);
  assert.equal(roleDescriptor('director')?.label,'РП');assert.equal(roleDescriptor('customer')?.pilot,false);
  for(const code of ['rp','superadmin','constructor','toString','__proto__',null,42])assert.equal(isKnownRole(code),false);
  assert.ok(Object.isFrozen(roleCatalog));assert.ok(roleCatalog.every(Object.isFrozen));
});
test('D01 GD company summaries do not grant personnel or foreign-company access',()=>{
  assert.ok(roleContractAllows({role:'gd',tenantId:tenant},'summary.company.read',{tenantId:tenant}));
  assert.ok(roleContractAllows({role:'gd',tenantId:tenant},'summary.project.read',resource));
  assert.equal(allow('gd','summary.company.read',{...resource,tenantId:other}),false);
  assert.equal(allow('gd','summary.company.read',{...resource,personalData:true}),false);
  for(const permission of ['personnel.company.read','personnel.project.read','personnel.employer.read']as const)assert.equal(allow('gd',permission),false);
});
test('project readers need a trusted assigned project, finance also needs explicit view permission',()=>{
  assert.ok(allow('director','summary.project.read'));
  assert.equal(allow('director','summary.project.read',{...resource,projectId:other}),false);
  assert.equal(roleContractAllows({role:'director',tenantId:tenant},'summary.project.read',resource),false);
  for(const role of ['peo','gb','uo']){
    assert.equal(allow(role,'summary.project.read'),false);
    assert.ok(roleContractAllows({...actor(role),readPermissions:['summary.project.read']},'summary.project.read',resource));
    assert.equal(roleContractAllows({...actor(role),readPermissions:['summary.project.read']},'summary.project.read',{...resource,projectId:other}),false);
  }
});
test('subcontractor needs both project and employer; tenant alone never grants employee access',()=>{
  for(const permission of ['personnel.employer.read','tasks.employer.read']as const){
    assert.ok(allow('subcontractor',permission));
    for(const target of [{...resource,employerId:other},{...resource,projectId:other},{...resource,tenantId:other},{...resource,employerId:undefined}])assert.equal(allow('subcontractor',permission,target),false);
    assert.equal(roleContractAllows({...actor('subcontractor'),employerIds:[]},permission,resource),false);
  }
  assert.equal(allow('subcontractor','personnel.company.read'),false);
});
test('self and crew contracts keep people, crews and employers separate',()=>{
  assert.ok(allow('worker','tasks.self.read'));assert.equal(allow('worker','tasks.self.read',{...resource,employeeId:other}),false);
  assert.ok(allow('brigadier','crew.volume.report'));
  for(const target of [{...resource,crewId:other},{...resource,employerId:other},{...resource,crewId:undefined}])assert.equal(allow('brigadier','crew.volume.report',target),false);
  assert.equal(allow('worker','crew.volume.report'),false);
});
test('admin config is scoped and never a blanket editor of confirmed production data',()=>{
  assert.ok(allow('admin','routes.configure'));assert.equal(allow('admin','routes.configure',{...resource,projectId:other}),false);
  assert.equal(allow('director','routes.configure'),false);
  for(const role of roleCatalog){
    assert.equal(allow(role.code,'confirmed.production.edit'),false);
    assert.equal(allow(role.code,'unknown.action' as ContractPermission),false);
    assert.equal(allow(role.code,'routes.configure',{...resource,tenantId:other}),false);
  }
});
async function guard(role:string,method:string,path:string){
  const auth={actor:async()=>({tenantId:tenant,userId:employee,role,name:'QA',email:'qa@example.test'})}as unknown as AuthService;
  const request={headers:{authorization:'Bearer '+'a'.repeat(64),'x-tenant-id':tenant},method,path};
  return new TenantGuard(auth).canActivate({switchToHttp:()=>({getRequest:()=>request})}as unknown as ExecutionContext);
}
test('reserved roles authenticate identity/logout but cannot fall through any business handler',async()=>{
  for(const role of roleCatalog.filter(r=>!isExistingRuntimeRole(r.code))){
    assert.equal(await guard(role.code,'GET','/api/v1/me'),true);
    assert.equal(await guard(role.code,'POST','/api/v1/auth/logout'),true);
    for(const [method,path]of [['GET','/api/desk'],['GET','/api/v1/employees'],['POST','/api/tasks'],['POST','/api/projects/x/place'],['POST','/api/v1/execution/events'],['POST','/api/v1/me']]){
      await assert.rejects(guard(role.code,method!,path!),{message:'role_denied'});
    }
  }
  await assert.rejects(guard('constructor','GET','/api/v1/me'),{message:'role_denied'});
});
test('existing role guard behaviour remains unchanged',async()=>{
  for(const role of roleCatalog.filter(r=>isExistingRuntimeRole(r.code)))assert.equal(await guard(role.code,'GET','/api/desk'),true);
  assert.equal(await guard('director','POST','/api/tasks'),true);
  for(const role of ['gd','admin','hr','customer'])await assert.rejects(guard(role,'POST','/api/tasks'),{message:'role_denied'});
});
test('supply writes only its material batch routes',async()=>{
  assert.ok(allow('master','materials.record'));assert.ok(allow('supply','materials.read'));assert.ok(allow('pto','materials.read'));
  assert.equal(allow('pto','materials.record'),false);assert.equal(allow('director','materials.read'),false);
  assert.equal(allow('supply','materials.record',{...resource,projectId:other}),false);
  assert.equal(await guard('supply','POST',`/api/v1/projects/${project}/material-batches`),true);
  assert.equal(await guard('supply','PUT',`/api/v1/projects/${project}/material-batches/${employer}/documents/${employee}/content`),true);
  await assert.rejects(guard('supply','POST','/api/v1/employees'),{message:'role_denied'});
  await assert.rejects(guard('supply','POST','/api/tasks'),{message:'role_denied'});
  await assert.rejects(guard('supply','POST',`/api/v1/projects/${project}/tasks`),{message:'role_denied'});
});
