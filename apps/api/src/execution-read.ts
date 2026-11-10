import type {PoolClient} from 'pg';
import type {Actor} from './workforce.service.js';
import {httpError} from './errors.js';
// All aliases are explicit; every query checks the current membership/link/assignment.
// $1 tenant, $2 user, $3 optional project. No cached Guard role is used.
export const executionScope=`p.tenant_id=$1 AND ($3::uuid IS NULL OR p.id=$3) AND EXISTS (
 SELECT 1 FROM memberships m WHERE m.tenant_id=p.tenant_id AND m.user_id=$2 AND m.status='active' AND (
 m.role='director' OR (m.role IN ('master','pto','worker') AND EXISTS (
 SELECT 1 FROM project_memberships pm WHERE pm.tenant_id=p.tenant_id AND pm.project_id=p.id AND pm.user_id=m.user_id AND pm.status='active')
 AND (m.role<>'worker' OR (e.user_id=m.user_id AND e.status='active' AND EXISTS (
 SELECT 1 FROM employee_project_assignments a WHERE a.tenant_id=p.tenant_id AND a.project_id=p.id AND a.employee_id=e.id AND a.status='active'))))))`;
export const executionJoin=`JOIN projects p ON p.tenant_id=s.tenant_id AND p.id=s.project_id JOIN employees e ON e.tenant_id=s.tenant_id AND e.id=s.employee_id`;
export async function executionClock(c:PoolClient,a:Actor,requestedDay?:string,requestedAsOf?:string){
 const t=(await c.query(`SELECT timezone,date_trunc('milliseconds',clock_timestamp()) server_time FROM tenants WHERE id=$1`,[a.tenantId])).rows[0];
 if(!t||!(await c.query(`SELECT 1 FROM pg_timezone_names WHERE name=$1`,[t.timezone])).rowCount)throw httpError(422,'invalid_tenant_timezone');
 if(requestedAsOf&&+new Date(requestedAsOf)>+t.server_time)throw httpError(400,'future_as_of');
 const asOf=requestedAsOf??t.server_time.toISOString();
 const day=requestedDay??(await c.query(`SELECT to_char($1::timestamptz AT TIME ZONE $2,'YYYY-MM-DD') AS day`,[asOf,t.timezone])).rows[0].day;
 return {day,timezone:t.timezone as string,asOf,source:'server_as_of' as const,provisional:true as const};
}
// Exact shared civil clipping; callers choose their own visibility/recorded predicate.
export const civilClipStart=`greatest(s.started_at,$4::date::timestamp AT TIME ZONE $5)`;
export const civilClipEnd=`least(coalesce(s.ended_at,$6::timestamptz),$6::timestamptz,(($4::date+1)::timestamp AT TIME ZONE $5))`;
export const civilClipMs=`greatest(0,extract(epoch FROM (${civilClipEnd}-${civilClipStart}))*1000)::bigint`;
export async function executionTotals(c:PoolClient,a:Actor,projectId:string|undefined,clock:{day:string;timezone:string;asOf:string},employeeId?:string){
 const values=[a.tenantId,a.userId,projectId??null,clock.day,clock.timezone,clock.asOf,employeeId??null];
 const clipped=`WITH clipped AS (SELECT s.task_id,s.mode,s.ended_at IS NULL AND s.started_at<$6::timestamptz AND s.started_at<(($4::date+1)::timestamp AT TIME ZONE $5) AND $6::timestamptz>($4::date::timestamp AT TIME ZONE $5) open,
 ${civilClipMs} ms
 FROM managed_segments s ${executionJoin} WHERE ${executionScope} AND ($7::uuid IS NULL OR e.id=$7))`;
 const totals=(await c.query(`${clipped} SELECT coalesce(sum(ms),0)::text AS "presenceMs",coalesce(sum(ms) FILTER(WHERE mode='idle'),0)::text AS "idleMs",coalesce(sum(ms) FILTER(WHERE mode='work'),0)::text AS "workMs",coalesce(sum(ms) FILTER(WHERE mode='break'),0)::text AS "breakMs",coalesce(sum(ms) FILTER(WHERE mode='downtime'),0)::text AS "downtimeMs",coalesce(bool_or(open),false) AS "hasOpenIntervals" FROM clipped`,values)).rows[0];
 const tasks=(await c.query(`${clipped} SELECT task_id AS "taskId",coalesce(sum(ms) FILTER(WHERE mode='work'),0)::text AS "workMs",coalesce(sum(ms) FILTER(WHERE mode='downtime'),0)::text AS "downtimeMs" FROM clipped WHERE task_id IS NOT NULL AND ms>0 GROUP BY task_id ORDER BY task_id`,values)).rows;
 return {...totals,tasks};
}
export async function managedOverview(c:PoolClient,a:Actor,projectId:string|undefined,requestedDay:string){
 const clock=await executionClock(c,a,requestedDay),v=[a.tenantId,a.userId,projectId??null,clock.day,clock.timezone];
 const daily=`ev.occurred_at>=($4::date::timestamp AT TIME ZONE $5) AND ev.occurred_at<(($4::date+1)::timestamp AT TIME ZONE $5)`;
 const counts=(await c.query(`SELECT count(DISTINCT s.employee_id) FILTER(WHERE s.started_at>=($4::date::timestamp AT TIME ZONE $5) AND s.started_at<(($4::date+1)::timestamp AT TIME ZONE $5))::int AS "employeesStartedShiftsForDay",count(*) FILTER(WHERE s.ended_at IS NULL)::int AS "currentOpenShifts" FROM managed_shifts s ${executionJoin} WHERE ${executionScope}`,v)).rows[0];
 const reports=`FROM managed_execution_reports s ${executionJoin} JOIN managed_execution_events ev ON ev.tenant_id=s.tenant_id AND ev.actor_user_id=s.actor_user_id AND ev.request_id=s.request_id JOIN daily_tasks t ON t.tenant_id=s.tenant_id AND t.project_id=s.project_id AND t.id=s.task_id WHERE ${executionScope} AND ${daily}`;
 const n=(await c.query(`SELECT count(*)::int n ${reports}`,v)).rows[0].n;
 const quantities=(await c.query(`SELECT t.unit,sum(s.submitted_quantity)::text AS "submittedQuantity",NULL AS "acceptedQuantity" ${reports} GROUP BY t.unit ORDER BY t.unit`,v)).rows;
 return {...clock,...counts,submittedReportsForDay:n,quantities,...await executionTotals(c,a,projectId,clock),reportDateSource:'managed_execution_events.occurred_at',shiftStartSource:'managed_shifts.started_at'};
}
