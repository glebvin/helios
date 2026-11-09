import { Body,Controller,Get,Inject,Param,Post,Put,Query,Req,Res,UseGuards } from '@nestjs/common';
import { actorOf,TenantGuard,type ActorRequest } from './auth.service.js';
import { page,queryInput,uuid } from './api-input.js';
import { PeopleService } from './people.service.js';
type Response = { status(n:number): Response; json(body:unknown): unknown };
@Controller('api/v1')
@UseGuards(TenantGuard)
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
}
