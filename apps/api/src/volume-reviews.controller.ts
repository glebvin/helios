import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { actorOf, TenantGuard, type ActorRequest } from './auth.service.js';
import { day, page, queryInput, uuid } from './api-input.js';
import { httpError } from './errors.js';
import { VolumeReviewsService } from './volume-reviews.service.js';

@Controller('api/v1/projects/:project/volume-reviews')
@UseGuards(TenantGuard)
export class VolumeReviewsController {
  constructor(@Inject(VolumeReviewsService) private readonly reviews: VolumeReviewsService) {}
  @Get()
  list(@Req() r: ActorRequest, @Param('project') p: string, @Query() q: Record<string, unknown>) {
    queryInput(q, ['day', 'limit', 'offset']);
    if (q.day === undefined) throw httpError(400, 'invalid_day');
    return this.reviews.list(actorOf(r), uuid(p).toLowerCase(), day(q.day)!, page(q));
  }
  @Get(':report')
  read(@Req() r: ActorRequest, @Param('project') p: string, @Param('report') id: string, @Query() q: Record<string, unknown>) {
    queryInput(q, []);
    return this.reviews.read(actorOf(r), uuid(p).toLowerCase(), uuid(id).toLowerCase());
  }
  @Post(':report')
  async review(@Req() r: ActorRequest, @Param('project') p: string, @Param('report') id: string, @Body() b: unknown, @Query() q: Record<string, unknown>, @Res() response: {status(code: number): {json(body: unknown): void}}) {
    queryInput(q, []);
    const result = await this.reviews.review(actorOf(r), uuid(p).toLowerCase(), uuid(id).toLowerCase(), b);
    response.status(result.status).json(result.body);
  }
  @Post(':report/remainder')
  async remainder(@Req() r: ActorRequest,@Param('project') p:string,@Param('report') id:string,@Body() b:unknown,@Query() q:Record<string,unknown>,@Res() response:{status(code:number):{json(body:unknown):void}}) {
    queryInput(q,[]);
    const result=await this.reviews.remainder(actorOf(r),uuid(p).toLowerCase(),uuid(id).toLowerCase(),b);
    response.status(result.status).json(result.body);
  }

  @Post(':report/corrections')
  async correct(@Req() r: ActorRequest, @Param('project') p: string, @Param('report') id: string, @Body() b: unknown, @Query() q: Record<string, unknown>, @Res() response: {status(code:number):{json(body:unknown):void}}) {
    queryInput(q,[]);
    const result=await this.reviews.correct(actorOf(r),uuid(p).toLowerCase(),uuid(id).toLowerCase(),b);
    response.status(result.status).json(result.body);
  }

}
