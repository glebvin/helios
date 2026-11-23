import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { ServerResponse } from 'node:http';
import { TenantGuard, actorOf, type ActorRequest } from './auth.service.js';
import { queryInput, uuid } from './api-input.js';
import { CustomerSubmissionsService } from './customer-submissions.service.js';

@Controller('api/v1/projects/:project/accepted-parts/:part/customer-submission')
@UseGuards(TenantGuard)
export class CustomerSubmissionsController {
  constructor(@Inject(CustomerSubmissionsService) private readonly submissions: CustomerSubmissionsService) {}
  @Get()
  read(@Req() r: ActorRequest, @Param('project') p: string, @Param('part') part: string, @Query() q: Record<string, unknown>) {
    queryInput(q, []);
    return this.submissions.read(actorOf(r), uuid(p).toLowerCase(), uuid(part).toLowerCase());
  }
  @Post()
  async submit(@Req() r: ActorRequest, @Param('project') p: string, @Param('part') part: string, @Body() b: unknown, @Query() q: Record<string, unknown>, @Res() res: { status(n: number): { json(body: unknown): void } }) {
    queryInput(q, []);
    const saved = await this.submissions.submit(actorOf(r), uuid(p).toLowerCase(), uuid(part).toLowerCase(), b);
    res.status(saved.status).json(saved.body);
  }
  @Post('remarks')
  async remark(@Req() r: ActorRequest, @Param('project') p: string, @Param('part') part: string, @Body() b: unknown, @Query() q: Record<string, unknown>, @Res() res: { status(n: number): { json(body: unknown): void } }) {
    queryInput(q, []);
    const saved = await this.submissions.remark(actorOf(r), uuid(p).toLowerCase(), uuid(part).toLowerCase(), b);
    res.status(saved.status).json(saved.body);
  }
  @Post('remarks/:remark/close')
  async close(@Req() r: ActorRequest, @Param('project') p: string, @Param('part') part: string, @Param('remark') remark: string, @Body() b: unknown, @Query() q: Record<string, unknown>, @Res() res: { status(n: number): { json(body: unknown): void } }) {
    queryInput(q, []);
    const saved = await this.submissions.closeRemark(actorOf(r), uuid(p).toLowerCase(), uuid(part).toLowerCase(), uuid(remark).toLowerCase(), b);
    res.status(saved.status).json(saved.body);
  }
  @Post('remarks/:remark/photos')
  async photo(@Req() r: ActorRequest, @Param('project') p: string, @Param('part') part: string, @Param('remark') remark: string, @Body() b: unknown, @Query() q: Record<string, unknown>, @Res() res: { status(n: number): { json(body: unknown): void } }) {
    queryInput(q, []);
    const saved = await this.submissions.photo(actorOf(r), uuid(p).toLowerCase(), uuid(part).toLowerCase(), uuid(remark).toLowerCase(), b);
    res.status(saved.status).json(saved.body);
  }
  @Get('remarks/:remark/photos/:photo')
  async download(@Req() r: ActorRequest, @Param('project') p: string, @Param('part') part: string, @Param('remark') remark: string, @Param('photo') photo: string, @Query() q: Record<string, unknown>, @Res() response: ServerResponse) {
    queryInput(q, []);
    const file = await this.submissions.download(actorOf(r), uuid(p).toLowerCase(), uuid(part).toLowerCase(), uuid(remark).toLowerCase(), uuid(photo).toLowerCase());
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    response.statusCode = 200;
    response.end(file.bytes);
  }
  @Post('decision')
  async decide(@Req() r: ActorRequest, @Param('project') p: string, @Param('part') part: string, @Body() b: unknown, @Query() q: Record<string, unknown>, @Res() res: { status(n: number): { json(body: unknown): void } }) {
    queryInput(q, []);
    const saved = await this.submissions.decide(actorOf(r), uuid(p).toLowerCase(), uuid(part).toLowerCase(), b);
    res.status(saved.status).json(saved.body);
  }
  @Post('scans')
  async scan(@Req() r: ActorRequest, @Param('project') p: string, @Param('part') part: string, @Body() b: unknown, @Query() q: Record<string, unknown>, @Res() res: { status(n: number): { json(body: unknown): void } }) {
    queryInput(q, []);
    const saved = await this.submissions.scan(actorOf(r), uuid(p).toLowerCase(), uuid(part).toLowerCase(), b);
    res.status(saved.status).json(saved.body);
  }
  @Get('scans/:scan')
  async downloadScan(@Req() r: ActorRequest, @Param('project') p: string, @Param('part') part: string, @Param('scan') scan: string, @Query() q: Record<string, unknown>, @Res() response: ServerResponse) {
    queryInput(q, []);
    const file = await this.submissions.downloadScan(actorOf(r), uuid(p).toLowerCase(), uuid(part).toLowerCase(), uuid(scan).toLowerCase());
    response.setHeader('Content-Type', file.contentType);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'private, no-store');
    response.statusCode = 200;
    response.end(file.bytes);
  }
}

@Controller('api/v1/projects/:project/customer-submission-zones')
@UseGuards(TenantGuard)
export class CustomerSubmissionZonesController {
  constructor(@Inject(CustomerSubmissionsService) private readonly submissions: CustomerSubmissionsService) {}
  @Get()
  zones(@Req() r: ActorRequest, @Param('project') p: string, @Query() q: Record<string, unknown>) {
    queryInput(q, []);
    return this.submissions.zones(actorOf(r), uuid(p).toLowerCase());
  }
}

@Controller('api/v1/projects/:project/customer-remark-tasks')
@UseGuards(TenantGuard)
export class CustomerRemarkTasksController {
  constructor(@Inject(CustomerSubmissionsService) private readonly submissions: CustomerSubmissionsService) {}
  @Get()
  tasks(@Req() r: ActorRequest, @Param('project') p: string, @Query() q: Record<string, unknown>) {
    queryInput(q, []);
    return this.submissions.myRemarkTasks(actorOf(r), uuid(p).toLowerCase());
  }
}
