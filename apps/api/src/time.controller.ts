import {Body,Controller,Get,Post,Param,Query,Req,Res,Inject,UseGuards} from '@nestjs/common';
import {TenantGuard,actorOf,type ActorRequest} from './auth.service.js';
import {uuid,day,queryInput,page} from './api-input.js';
import {timeRange} from './time-input.js';
import {TimeService} from './time.service.js';
const normalized=(v:string)=>uuid(v).toLowerCase();
const civilDay=(v:string)=>day(v)!;
@Controller('api/v1/projects/:p/time')
@UseGuards(TenantGuard)
export class TimeController {
 constructor(@Inject(TimeService)private readonly time:TimeService){}
 @Get('export.xlsx') async export(@Req()r:ActorRequest,@Param('p')p:string,@Query()q:Record<string,unknown>,@Res()res:any){
 const range=timeRange(q),bytes=await this.time.export(actorOf(r),normalized(p),range);
 res.set({'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="time-${range.from}-${range.to}.xlsx"`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}).send(bytes);
 }
 @Get('employees/:employee/days/:day') get(@Req()r:ActorRequest,@Param('p')p:string,@Param('employee')e:string,@Param('day')d:string,@Query()q:Record<string,unknown>){queryInput(q,[]);return this.time.day(actorOf(r),normalized(p),normalized(e),civilDay(d));}
 @Get('employees/:employee/days/:day/history') history(@Req()r:ActorRequest,@Param('p')p:string,@Param('employee')e:string,@Param('day')d:string,@Query()q:Record<string,unknown>){queryInput(q,['limit','offset']);return this.time.history(actorOf(r),normalized(p),normalized(e),civilDay(d),page({...q,limit:q.limit??'50'}));}
 @Post('employees/:employee/days/:day/approvals') async approve(@Req()r:ActorRequest,@Param('p')p:string,@Param('employee')e:string,@Param('day')d:string,@Query()q:Record<string,unknown>,@Body()b:unknown,@Res()res:any){queryInput(q,[]);const v=await this.time.command(actorOf(r),normalized(p),normalized(e),civilDay(d),b);res.status(v.status).json(v.body);}
 @Post('employees/:employee/days/:day/revoke') async revoke(@Req()r:ActorRequest,@Param('p')p:string,@Param('employee')e:string,@Param('day')d:string,@Query()q:Record<string,unknown>,@Body()b:unknown,@Res()res:any){queryInput(q,[]);const v=await this.time.command(actorOf(r),normalized(p),normalized(e),civilDay(d),b,true);res.status(v.status).json(v.body);}
}
