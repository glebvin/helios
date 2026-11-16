import { Body, Controller, Get, Inject, Param, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { actorOf, TenantGuard, type ActorRequest } from './auth.service.js';
import { queryInput, uuid } from './api-input.js';
import { httpError } from './errors.js';
import { materialPage, MaterialBatchService } from './material-batches.service.js';
import { evidenceDisposition } from './evidence-input.js';

@Controller('api/v1/material-batches')
@UseGuards(TenantGuard)
export class MaterialBatchProjectController {
  constructor(@Inject(MaterialBatchService) private readonly batches: MaterialBatchService) {}

  @Get('projects')
  projects(@Req() request: ActorRequest) {
    return this.batches.projects(actorOf(request));
  }
}

@Controller('api/v1/projects/:projectId/material-batches')
@UseGuards(TenantGuard)
export class MaterialBatchController {
  constructor(@Inject(MaterialBatchService) private readonly batches: MaterialBatchService) {}

  @Get()
  list(@Req() request: ActorRequest, @Param('projectId') projectId: string, @Query() query: Record<string, unknown>) {
    queryInput(query, ['q', 'limit', 'offset', 'usable', 'zoneId', 'workTypeId']);
    const q = query.q === undefined ? '' : String(query.q);
    if (q.length > 80) throw httpError(400, 'invalid_query');
    const usable = query.usable === undefined ? null : query.usable === '1' ? { zoneId: uuid(query.zoneId), workTypeId: uuid(query.workTypeId) } : null;
    if (query.usable !== undefined && !usable) throw httpError(400, 'invalid_query');
    return this.batches.list(actorOf(request), projectId, materialPage(query), q.trim(), usable);
  }

  @Post()
  async create(@Req() request: ActorRequest, @Param('projectId') projectId: string, @Body() body: unknown, @Res() response: { status: (code: number) => { json: (value: unknown) => void } }) {
    const result = await this.batches.create(actorOf(request), projectId, body);
    response.status(result.status).json(result.body);
  }

  @Put(':batchId/documents/:documentId/content')
  upload(@Req() request: ActorRequest & IncomingMessage, @Param('projectId') projectId: string, @Param('batchId') batchId: string, @Param('documentId') documentId: string) {
    return this.batches.upload(actorOf(request), projectId, batchId, documentId, request);
  }

  @Get(':batchId/documents/:documentId/content')
  async download(@Req() request: ActorRequest, @Param('projectId') projectId: string, @Param('batchId') batchId: string, @Param('documentId') documentId: string, @Res() response: ServerResponse) {
    const file = await this.batches.download(actorOf(request), projectId, batchId, documentId);
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('Content-Disposition', evidenceDisposition(file.filename));
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
    response.setHeader('Cache-Control', 'private, no-store');
    response.setHeader('Content-Length', file.bytes.length);
    response.end(file.bytes);
  }

  @Post(':batchId/control')
  async decide(@Req() request: ActorRequest, @Param('projectId') projectId: string, @Param('batchId') batchId: string, @Body() body: unknown, @Res() response: { status: (code: number) => { json: (value: unknown) => void } }) {
    const result = await this.batches.decide(actorOf(request), projectId, batchId, body);
    response.status(result.status).json(result.body);
  }

  @Get(':batchId')
  read(@Req() request: ActorRequest, @Param('projectId') projectId: string, @Param('batchId') batchId: string) {
    return this.batches.read(actorOf(request), projectId, batchId);
  }

  @Post(':batchId')
  async edit(@Req() request: ActorRequest, @Param('projectId') projectId: string, @Param('batchId') batchId: string, @Body() body: unknown, @Res() response: { status: (code: number) => { json: (value: unknown) => void } }) {
    const result = await this.batches.edit(actorOf(request), projectId, batchId, body);
    response.status(result.status).json(result.body);
  }
}
