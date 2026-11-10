import { Body,Controller,Get,Inject,Param,Post,Put,Query,Req,Res,UseGuards,type CanActivate,type ExecutionContext } from '@nestjs/common';
import { actorOf,TenantGuard,type ActorRequest } from './auth.service.js';
import { page,queryInput,uuid } from './api-input.js';
import { PeopleService } from './people.service.js';
type Response = { status(n:number): Response; json(body:unknown): unknown };
class PeopleCommandQueryGuard implements CanActivate {
  canActivate(context:ExecutionContext) {
    const request=context.switchToHttp().getRequest();
    if(request.method!=='GET')queryInput(request.query,[]);
    return true;
  }
}
@Controller('api/v1')
@UseGuards(TenantGuard,PeopleCommandQueryGuard)
export class PeopleController {
  constructor(@Inject(PeopleService) private readonly people: PeopleService) {}
  private async send(response:Response,result:ReturnType<PeopleService['createEmployee']>) {const r=await result;return response.status(r.status).json(r.body);}
  @Post('employees')
  create(@Req() r:ActorRequest,@Body() b:unknown,@Res() s:Response) {return this.send(s,this.people.createEmployee(actorOf(r),b));}
  @Put('employees/:id')
  update(@Req() r:ActorRequest,@Param('id') id:string,@Body() b:unknown,@Res() s:Response) {return this.send(s,this.people.updateEmployee(actorOf(r),uuid(id).toLowerCase(),b));}
  @Get('employees/:id/qualifications')
  qualifications(@Req() r:ActorRequest,@Param('id') id:string,@Query() q:Record<string,unknown>) {queryInput(q,['limit','offset']);return this.people.qualifications(actorOf(r),uuid(id),page(q));}
  @Post('employees/:id/qualifications')
  qualification(@Req() r:ActorRequest,@Param('id') id:string,@Body() b:unknown,@Res() s:Response) {return this.send(s,this.people.writeQualification(actorOf(r),uuid(id).toLowerCase(),b));}
  @Put('employees/:id/qualifications/:qid')
  qualificationUpdate(@Req() r:ActorRequest,@Param('id') id:string,@Param('qid') qid:string,@Body() b:unknown,@Res() s:Response) {return this.send(s,this.people.writeQualification(actorOf(r),uuid(id).toLowerCase(),b,uuid(qid).toLowerCase()));}
  @Get('projects/:p/admission-template')
  template(@Req() r:ActorRequest,@Param('p') p:string,@Query() q:Record<string,unknown>) {queryInput(q,[]);return this.people.template(actorOf(r),uuid(p));}
  @Get('projects/:p/admission-template/versions')
  templateVersions(@Req() r:ActorRequest,@Param('p') p:string,@Query() q:Record<string,unknown>) {queryInput(q,['limit','offset']);return this.people.template(actorOf(r),uuid(p),page(q));}
  @Post('projects/:p/admission-template')
  templateCreate(@Req() r:ActorRequest,@Param('p') p:string,@Body() b:unknown,@Res() s:Response) {return this.send(s,this.people.writeTemplate(actorOf(r),uuid(p).toLowerCase(),b));}
  @Put('projects/:p/admission-template')
  templateUpdate(@Req() r:ActorRequest,@Param('p') p:string,@Body() b:unknown,@Res() s:Response) {return this.send(s,this.people.writeTemplate(actorOf(r),uuid(p).toLowerCase(),b,true));}
  @Get('employees/:id/admission-checks')
  checks(@Req() r:ActorRequest,@Param('id') id:string,@Query() q:Record<string,unknown>) {queryInput(q,['limit','offset','projectId']);return this.people.checks(actorOf(r),uuid(id),page(q),q.projectId===undefined?undefined:uuid(q.projectId));}
  @Get('employees/:id/admission-checks/:check')
  check(@Req() r:ActorRequest,@Param('id') id:string,@Param('check') check:string,@Query() q:Record<string,unknown>) {queryInput(q,[]);return this.people.checks(actorOf(r),uuid(id),page({}),undefined,uuid(check));}
  @Post('employees/:id/admission-checks')
  checkCreate(@Req() r:ActorRequest,@Param('id') id:string,@Body() b:unknown,@Res() s:Response) {return this.send(s,this.people.writeCheck(actorOf(r),uuid(id).toLowerCase(),b));}
  @Get('projects/:p/memberships')
  memberships(@Req() r:ActorRequest,@Param('p') p:string,@Query() q:Record<string,unknown>) {queryInput(q,['limit','offset']);return this.people.memberships(actorOf(r),uuid(p),page(q));}
  @Put('projects/:p/memberships/:user')
  membership(@Req() r:ActorRequest,@Param('p') p:string,@Param('user') user:string,@Body() b:unknown,@Res() s:Response) {return this.send(s,this.people.writeMembership(actorOf(r),uuid(p).toLowerCase(),uuid(user).toLowerCase(),b));}
  @Get('projects/:p/assignments')
  assignments(@Req() r:ActorRequest,@Param('p') p:string,@Query() q:Record<string,unknown>) {queryInput(q,['limit','offset']);return this.people.assignments(actorOf(r),uuid(p),page(q));}
  @Put('projects/:p/assignments/:e')
  assignment(@Req() r:ActorRequest,@Param('p') p:string,@Param('e') e:string,@Body() b:unknown,@Res() s:Response) {return this.send(s,this.people.writeAssignment(actorOf(r),uuid(p).toLowerCase(),uuid(e).toLowerCase(),b));}
  @Get('projects/:p/crews')
  crews(@Req() r:ActorRequest,@Param('p') p:string,@Query() q:Record<string,unknown>) {queryInput(q,['limit','offset']);return this.people.crews(actorOf(r),uuid(p),page(q));}
  @Get('projects/:p/crews/:crew')
  crew(@Req() r:ActorRequest,@Param('p') p:string,@Param('crew') crew:string,@Query() q:Record<string,unknown>) {queryInput(q,[]);return this.people.crews(actorOf(r),uuid(p),page({}),uuid(crew));}
  @Post('projects/:p/crews')
  crewCreate(@Req() r:ActorRequest,@Param('p') p:string,@Body() b:unknown,@Res() s:Response) {return this.send(s,this.people.createCrew(actorOf(r),uuid(p).toLowerCase(),b));}
  @Put('projects/:p/crews/:crew/members/:e')
  crewMember(@Req() r:ActorRequest,@Param('p') p:string,@Param('crew') crew:string,@Param('e') e:string,@Body() b:unknown,@Res() s:Response) {return this.send(s,this.people.writeCrewMember(actorOf(r),uuid(p).toLowerCase(),uuid(crew).toLowerCase(),uuid(e).toLowerCase(),b));}
}
