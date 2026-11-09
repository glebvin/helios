import {Body,Controller,Get,Inject,Param,Post,Put,Query,Req,Res,UseGuards,type CanActivate,type ExecutionContext} from '@nestjs/common';
import {actorOf,TenantGuard,type ActorRequest} from './auth.service.js';
import {page,queryInput,uuid} from './api-input.js';
import {TasksService} from './tasks.service.js';
type Response={status(n:number):Response;json(body:unknown):unknown};
class TaskCommandQueryGuard implements CanActivate {
  canActivate(context:ExecutionContext){const r=context.switchToHttp().getRequest();if(r.method!=='GET')queryInput(r.query,[]);return true;}
}
@Controller('api/v1/projects/:p')
@UseGuards(TenantGuard,TaskCommandQueryGuard)
export class TasksController {
  constructor(@Inject(TasksService)private readonly tasks:TasksService){}
  private async send(s:Response,p:ReturnType<TasksService['writeTask']>){const r=await p;return s.status(r.status).json(r.body);}
  @Get('zones')
  zones(@Req()r:ActorRequest,@Param('p')p:string,@Query()q:Record<string,unknown>){queryInput(q,['limit','offset']);return this.tasks.catalogs(actorOf(r),uuid(p).toLowerCase(),'zones',page(q));}
  @Post('zones')
  createZone(@Req()r:ActorRequest,@Param('p')p:string,@Body()b:unknown,@Res()s:Response){return this.send(s,this.tasks.writeCatalog(actorOf(r),uuid(p).toLowerCase(),'zones',b));}
  @Put('zones/:id')
  zone(@Req()r:ActorRequest,@Param('p')p:string,@Param('id')id:string,@Body()b:unknown,@Res()s:Response){return this.send(s,this.tasks.writeCatalog(actorOf(r),uuid(p).toLowerCase(),'zones',b,uuid(id).toLowerCase()));}
  @Get('work-types')
  types(@Req()r:ActorRequest,@Param('p')p:string,@Query()q:Record<string,unknown>){queryInput(q,['limit','offset']);return this.tasks.catalogs(actorOf(r),uuid(p).toLowerCase(),'work-types',page(q));}
  @Post('work-types')
  createType(@Req()r:ActorRequest,@Param('p')p:string,@Body()b:unknown,@Res()s:Response){return this.send(s,this.tasks.writeCatalog(actorOf(r),uuid(p).toLowerCase(),'work-types',b));}
  @Put('work-types/:id')
  type(@Req()r:ActorRequest,@Param('p')p:string,@Param('id')id:string,@Body()b:unknown,@Res()s:Response){return this.send(s,this.tasks.writeCatalog(actorOf(r),uuid(p).toLowerCase(),'work-types',b,uuid(id).toLowerCase()));}
  @Post('tasks')
  createTask(@Req()r:ActorRequest,@Param('p')p:string,@Body()b:unknown,@Res()s:Response){return this.send(s,this.tasks.writeTask(actorOf(r),uuid(p).toLowerCase(),b));}
  @Put('tasks/:id')
  task(@Req()r:ActorRequest,@Param('p')p:string,@Param('id')id:string,@Body()b:unknown,@Res()s:Response){return this.send(s,this.tasks.writeTask(actorOf(r),uuid(p).toLowerCase(),b,uuid(id).toLowerCase()));}
  @Get('front-template')
  frontTemplate(@Req()r:ActorRequest,@Param('p')p:string,@Query()q:Record<string,unknown>){queryInput(q,[]);return this.tasks.frontTemplate(actorOf(r),uuid(p).toLowerCase());}
  @Get('front-template/versions')
  frontVersions(@Req()r:ActorRequest,@Param('p')p:string,@Query()q:Record<string,unknown>){queryInput(q,['limit','offset']);return this.tasks.frontTemplate(actorOf(r),uuid(p).toLowerCase(),page(q));}
  @Post('front-template')
  createFrontTemplate(@Req()r:ActorRequest,@Param('p')p:string,@Body()b:unknown,@Res()s:Response){return this.send(s,this.tasks.writeFrontTemplate(actorOf(r),uuid(p).toLowerCase(),b));}
  @Put('front-template')
  replaceFrontTemplate(@Req()r:ActorRequest,@Param('p')p:string,@Body()b:unknown,@Res()s:Response){return this.send(s,this.tasks.writeFrontTemplate(actorOf(r),uuid(p).toLowerCase(),b,true));}
  @Get('tasks/:id/front-checks')
  checks(@Req()r:ActorRequest,@Param('p')p:string,@Param('id')id:string,@Query()q:Record<string,unknown>){queryInput(q,['limit','offset']);return this.tasks.frontChecks(actorOf(r),uuid(p).toLowerCase(),uuid(id).toLowerCase(),page(q));}
  @Get('tasks/:id/front-checks/:check')
  check(@Req()r:ActorRequest,@Param('p')p:string,@Param('id')id:string,@Param('check')check:string,@Query()q:Record<string,unknown>){queryInput(q,[]);return this.tasks.frontChecks(actorOf(r),uuid(p).toLowerCase(),uuid(id).toLowerCase(),page({}),uuid(check).toLowerCase());}
  @Get('tasks/:id/readiness')
  readiness(@Req()r:ActorRequest,@Param('p')p:string,@Param('id')id:string,@Query()q:Record<string,unknown>){queryInput(q,[]);return this.tasks.taskReadiness(actorOf(r),uuid(p).toLowerCase(),uuid(id).toLowerCase());}
  @Post('tasks/:id/front-checks')
  createCheck(@Req()r:ActorRequest,@Param('p')p:string,@Param('id')id:string,@Body()b:unknown,@Res()s:Response){return this.send(s,this.tasks.writeFrontCheck(actorOf(r),uuid(p).toLowerCase(),uuid(id).toLowerCase(),b));}
  @Post('tasks/:id/submit')
  submit(@Req()r:ActorRequest,@Param('p')p:string,@Param('id')id:string,@Body()b:unknown,@Res()s:Response){return this.send(s,this.tasks.action(actorOf(r),uuid(p).toLowerCase(),uuid(id).toLowerCase(),b,'submit'));}
  @Post('tasks/:id/reject')
  reject(@Req()r:ActorRequest,@Param('p')p:string,@Param('id')id:string,@Body()b:unknown,@Res()s:Response){return this.send(s,this.tasks.action(actorOf(r),uuid(p).toLowerCase(),uuid(id).toLowerCase(),b,'reject'));}
  @Post('tasks/:id/reopen')
  reopen(@Req()r:ActorRequest,@Param('p')p:string,@Param('id')id:string,@Body()b:unknown,@Res()s:Response){return this.send(s,this.tasks.action(actorOf(r),uuid(p).toLowerCase(),uuid(id).toLowerCase(),b,'reopen'));}
  @Post('tasks/:id/cancel')
  cancel(@Req()r:ActorRequest,@Param('p')p:string,@Param('id')id:string,@Body()b:unknown,@Res()s:Response){return this.send(s,this.tasks.action(actorOf(r),uuid(p).toLowerCase(),uuid(id).toLowerCase(),b,'cancel'));}
  @Post('tasks/:id/publish')
  publish(@Req()r:ActorRequest,@Param('p')p:string,@Param('id')id:string,@Body()b:unknown,@Res()s:Response){return this.send(s,this.tasks.action(actorOf(r),uuid(p).toLowerCase(),uuid(id).toLowerCase(),b,'publish'));}
}
