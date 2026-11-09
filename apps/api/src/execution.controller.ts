import {Body,Controller,HttpCode,Inject,Post,Query,Req,UseGuards} from '@nestjs/common';
import {TenantGuard,actorOf,type ActorRequest} from './auth.service.js';
import {queryInput} from './api-input.js';
import {ExecutionService} from './execution.service.js';
@Controller('api/v1/execution')
@UseGuards(TenantGuard)
export class ExecutionController {
  constructor(@Inject(ExecutionService)private readonly execution:ExecutionService){}
  @Post('events')
  @HttpCode(200)
  events(@Req()r:ActorRequest,@Body()b:unknown,@Query()q:Record<string,unknown>){queryInput(q,[]);return this.execution.ingest(actorOf(r),b);}
}
