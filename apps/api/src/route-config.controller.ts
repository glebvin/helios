import {Body,Controller,Get,Inject,Param,Post,Query,Req,Res,UseGuards} from '@nestjs/common';
import {actorOf,TenantGuard,type ActorRequest} from './auth.service.js';
import {queryInput} from './api-input.js';
import {httpError} from './errors.js';
import {RouteConfigService} from './route-config.service.js';

@Controller('api/v1/projects/:projectId/route-config')
@UseGuards(TenantGuard)
export class RouteConfigController {
  constructor(@Inject(RouteConfigService)private readonly service:RouteConfigService){}
  @Get()
  get(@Req()r:ActorRequest,@Param('projectId')p:string,@Query()q:Record<string,unknown>){
    queryInput(q,['version']);let version:number|undefined;
    if(q.version!==undefined){if(typeof q.version!=='string'||!/^\d{1,10}$/.test(q.version)||Number(q.version)<1||Number(q.version)>2147483647)throw httpError(400,'invalid_version');version=Number(q.version);}
    return this.service.get(actorOf(r),p,version);
  }
  @Post()
  async save(@Req()r:ActorRequest,@Param('projectId')p:string,@Body()b:unknown,@Res()response:{status:(n:number)=>{json:(b:unknown)=>void}}){
    const result=await this.service.save(actorOf(r),p,b);response.status(result.status).json(result.body);
  }
}
