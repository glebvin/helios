import {Body,Controller,Get,Inject,Param,Post,Query,Req,Res,UseGuards} from '@nestjs/common';
import {TenantGuard,actorOf,type ActorRequest} from './auth.service.js';
import {queryInput,uuid} from './api-input.js';
import {InternalInspectionsService} from './internal-inspections.service.js';
@Controller('api/v1/projects/:project/accepted-parts/:part/internal-inspection')
@UseGuards(TenantGuard)
export class InternalInspectionsController {
  constructor(@Inject(InternalInspectionsService)private readonly inspections:InternalInspectionsService){}
  @Get()
  read(@Req()r:ActorRequest,@Param('project')p:string,@Param('part')part:string,@Query()q:Record<string,unknown>){queryInput(q,[]);return this.inspections.read(actorOf(r),uuid(p).toLowerCase(),uuid(part).toLowerCase());}
  @Post()
  async act(@Req()r:ActorRequest,@Param('project')p:string,@Param('part')part:string,@Body()b:unknown,@Query()q:Record<string,unknown>,@Res()res:{status(n:number):{json(b:unknown):void}}){queryInput(q,[]);const saved=await this.inspections.act(actorOf(r),uuid(p).toLowerCase(),uuid(part).toLowerCase(),b);res.status(saved.status).json(saved.body);}
}
@Controller('api/v1/projects/:project/internal-inspection-policy')
@UseGuards(TenantGuard)
export class InternalInspectionPolicyController {
  constructor(@Inject(InternalInspectionsService)private readonly inspections:InternalInspectionsService){}
  @Get()
  read(@Req()r:ActorRequest,@Param('project')p:string,@Query()q:Record<string,unknown>){queryInput(q,[]);return this.inspections.readPolicy(actorOf(r),uuid(p).toLowerCase());}
  @Post()
  async save(@Req()r:ActorRequest,@Param('project')p:string,@Body()b:unknown,@Query()q:Record<string,unknown>,@Res()res:{status(n:number):{json(b:unknown):void}}){queryInput(q,[]);const saved=await this.inspections.savePolicy(actorOf(r),uuid(p).toLowerCase(),b);res.status(saved.status).json(saved.body);}
}
