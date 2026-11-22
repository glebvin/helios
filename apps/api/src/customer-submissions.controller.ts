import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
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
}
