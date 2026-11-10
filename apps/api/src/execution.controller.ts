import {Body,Controller,HttpCode,Get,Param,Inject,Post,Query,Req,UseGuards} from '@nestjs/common';
import {TenantGuard,actorOf,type ActorRequest} from './auth.service.js';
import {queryInput,page,uuid,day} from './api-input.js';
import {instant} from './task-input.js';
import {httpError} from './errors.js';
import {ExecutionService} from './execution.service.js';
@Controller('api/v1')
@UseGuards(TenantGuard)
export class ExecutionController {
  constructor(@Inject(ExecutionService)private readonly execution:ExecutionService){}
  @Post('execution/events')
  @HttpCode(200)
  events(@Req()r:ActorRequest,@Body()b:unknown,@Query()q:Record<string,unknown>){queryInput(q,[]);return this.execution.ingest(actorOf(r),b);}
  @Get('projects/:p/execution/shifts')
  shifts(@Req()r:ActorRequest,@Param('p')p:string,@Query()q:Record<string,unknown>){queryInput(q,['employeeId','limit','offset']);return this.execution.shifts(actorOf(r),uuid(p).toLowerCase(),page(q),q.employeeId===undefined?undefined:uuid(q.employeeId).toLowerCase());}
  @Get('projects/:p/execution/shifts/:shift/segments')
  segments(@Req()r:ActorRequest,@Param('p')p:string,@Param('shift')shift:string,@Query()q:Record<string,unknown>){queryInput(q,['limit','offset']);return this.execution.segments(actorOf(r),uuid(p).toLowerCase(),uuid(shift).toLowerCase(),page(q));}
  @Get('projects/:p/execution/reports')
  reports(@Req()r:ActorRequest,@Param('p')p:string,@Query()q:Record<string,unknown>){queryInput(q,['employeeId','taskId','day','limit','offset']);return this.execution.reports(actorOf(r),uuid(p).toLowerCase(),page(q),q.employeeId===undefined?undefined:uuid(q.employeeId).toLowerCase(),q.taskId===undefined?undefined:uuid(q.taskId).toLowerCase(),day(q.day));}
  @Get('projects/:p/execution/employees/:employee/day')
  day(@Req()r:ActorRequest,@Param('p')p:string,@Param('employee')employee:string,@Query()q:Record<string,unknown>){queryInput(q,['day','asOf']);if(q.day===undefined)throw httpError(400,'invalid_day');return this.execution.day(actorOf(r),uuid(p).toLowerCase(),uuid(employee).toLowerCase(),day(q.day)!,q.asOf===undefined?undefined:instant(q.asOf));}
}
