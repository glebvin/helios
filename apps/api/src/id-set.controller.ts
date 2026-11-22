import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { actorOf, TenantGuard, type ActorRequest } from './auth.service.js';
import { queryInput, uuid } from './api-input.js';
import { IdSetService } from './id-set.service.js';

type Response = { status(code: number): Response; json(body: unknown): unknown };

@Controller('api/v1/projects/:p')
@UseGuards(TenantGuard)
export class IdSetController {
  constructor(@Inject(IdSetService) private readonly sets: IdSetService) {}

  @Get('id-sets')
  list(@Req() request: ActorRequest, @Param('p') projectId: string, @Query() query: Record<string, unknown>) {
    queryInput(query, []);
    return this.sets.list(actorOf(request), uuid(projectId).toLowerCase());
  }

  @Post('work-types/:workType/id-set')
  async write(@Req() request: ActorRequest, @Param('p') projectId: string, @Param('workType') workTypeId: string, @Body() body: unknown, @Res() response: Response) {
    const result = await this.sets.write(actorOf(request), uuid(projectId).toLowerCase(), uuid(workTypeId).toLowerCase(), body);
    return response.status(result.status).json(result.body);
  }
}
