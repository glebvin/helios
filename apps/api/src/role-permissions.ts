/** Contracts for new module adapters. No request may supply its own AuthorizedScope.
 * Load scope and resource ownership from the authenticated DB transaction. Existing
 * APIs retain their guards; reserved roles are denied business routes until a module
 * explicitly connects its operation and tests it. A positive contract is not activation.
 */
import { roleDescriptor } from './role-catalog.js';

export type ContractPermission =
  | 'summary.company.read' | 'summary.project.read'
  | 'personnel.company.read' | 'personnel.project.read' | 'personnel.employer.read'
  | 'tasks.self.read' | 'tasks.employer.read' | 'crew.volume.report'
  | 'routes.configure' | 'confirmed.production.edit' | 'prices.maintain';
export type AuthorizedScope = {
  tenantId: string; role: string; employeeId?: string;
  projectIds?: readonly string[]; employerIds?: readonly string[]; crewIds?: readonly string[];
  readPermissions?: readonly ContractPermission[];
};
export type ResourceScope = {
  tenantId: string; projectId?: string; employerId?: string; employeeId?: string; crewId?: string;
  personalData?: boolean;
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function same(left: string | undefined, right: string | undefined) {
  return typeof left === 'string' && typeof right === 'string' && uuid.test(left) && uuid.test(right) && left.toLowerCase() === right.toLowerCase();
}
function listed(values: readonly string[] | undefined, value: string | undefined) {
  return !!values?.some(item => same(item, value));
}
export function roleContractAllows(actor: AuthorizedScope, permission: ContractPermission, resource: ResourceScope): boolean {
  const role = roleDescriptor(actor.role);
  if (!role?.pilot || !same(actor.tenantId, resource.tenantId)) return false;
  const project = listed(actor.projectIds, resource.projectId);
  const employer = listed(actor.employerIds, resource.employerId);
  switch (permission) {
    case 'summary.company.read':
      return actor.role === 'gd' && resource.personalData !== true;
    case 'summary.project.read':
      if (resource.personalData === true) return false;
      if (actor.role === 'gd') return true; // D-01: every project of the same company.
      if (!project) return false;
      if (['director', 'master', 'pto', 'ds', 'zds-sso', 'zds-soso'].includes(actor.role)) return true;
      return ['peo', 'gb', 'uo'].includes(actor.role) && actor.readPermissions?.includes(permission) === true;
    case 'personnel.company.read':
      return actor.role === 'hr';
    case 'personnel.project.read':
      return project && ['director', 'master', 'safety', 'hr'].includes(actor.role);
    case 'personnel.employer.read':
    case 'tasks.employer.read':
      return actor.role === 'subcontractor' && project && employer;
    case 'tasks.self.read':
      return ['worker', 'brigadier'].includes(actor.role) && project && same(actor.employeeId, resource.employeeId);
    case 'crew.volume.report':
      return actor.role === 'brigadier' && project && employer && listed(actor.crewIds, resource.crewId);
    case 'routes.configure':
      return actor.role === 'admin' && project;
    case 'prices.maintain':
      return actor.role === 'cost' && (resource.projectId === undefined || project);
    case 'confirmed.production.edit':
    default:
      return false; // Corrections use their own future operation, never a blanket editor.
  }
}
