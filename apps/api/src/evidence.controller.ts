import {Body,Controller,Get,Post,Put,Param,Query,Req,Res,Inject,UseGuards} from '@nestjs/common';
import type {IncomingMessage,ServerResponse} from 'node:http';
import {TenantGuard,actorOf,type ActorRequest} from './auth.service.js';
import {uuid,queryInput,page} from './api-input.js';
import {EvidenceService} from './evidence.service.js';
import {evidenceDisposition} from './evidence-input.js';
const normalized=(v:string)=>uuid(v).toLowerCase();
@Controller('api/v1/projects/:p/evidence')
@UseGuards(TenantGuard)
export class EvidenceController {
 constructor(@Inject(EvidenceService)private readonly evidence:EvidenceService){}
 @Post() async reserve(@Req()r:ActorRequest,@Param('p')p:string,@Body()b:unknown,@Query()q:Record<string,unknown>,@Res()res:any){queryInput(q,[]);const v=await this.evidence.reserve(actorOf(r),normalized(p),b);res.status(v.status).json(v.body);}
 @Get() list(@Req()r:ActorRequest,@Param('p')p:string,@Query()q:Record<string,unknown>){queryInput(q,['employeeId','limit','offset']);return this.evidence.list(actorOf(r),normalized(p),page(q),q.employeeId===undefined?undefined:normalized(uuid(q.employeeId)));}
 @Get(':file') metadata(@Req()r:ActorRequest,@Param('p')p:string,@Param('file')file:string,@Query()q:Record<string,unknown>){queryInput(q,[]);return this.evidence.get(actorOf(r),normalized(p),normalized(file));}
 @Put(':file/content') upload(@Req()r:ActorRequest&IncomingMessage,@Param('p')p:string,@Param('file')file:string,@Query()q:Record<string,unknown>){queryInput(q,[]);return this.evidence.upload(actorOf(r),normalized(p),normalized(file),r);}
 @Get(':file/content') async download(@Req()r:ActorRequest,@Param('p')p:string,@Param('file')file:string,@Query()q:Record<string,unknown>,@Res()res:ServerResponse){queryInput(q,[]);const v=await this.evidence.download(actorOf(r),normalized(p),normalized(file));res.setHeader('Content-Type',v.contentType);res.setHeader('Content-Disposition',evidenceDisposition(v.filename));res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'");res.setHeader('Cache-Control','private, no-store');res.setHeader('Content-Length',v.bytes.length);res.end(v.bytes);}
 @Post(':file/attachment') async attach(@Req()r:ActorRequest,@Param('p')p:string,@Param('file')file:string,@Body()b:unknown,@Query()q:Record<string,unknown>,@Res()res:any){queryInput(q,[]);const v=await this.evidence.attach(actorOf(r),normalized(p),normalized(file),b);res.status(v.status).json(v.body);}
}
