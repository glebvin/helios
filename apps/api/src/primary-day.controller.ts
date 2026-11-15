import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { TenantGuard, actorOf, type ActorRequest } from "./auth.service.js";
import { day, queryInput, uuid } from "./api-input.js";
import { PrimaryDayService } from "./primary-day.service.js";

const projectOf = (value: string) => uuid(value).toLowerCase();
const civilDay = (value: string) => day(value)!;

@Controller("api/v1/projects/:p/time")
@UseGuards(TenantGuard)
export class PrimaryDayController {
  constructor(@Inject(PrimaryDayService) private readonly days: PrimaryDayService) {}

  @Get("primary-days/:day")
  day(@Req() request: ActorRequest, @Param("p") projectId: string, @Param("day") dayValue: string, @Query() query: Record<string, unknown>) {
    queryInput(query, ["organizationId"]);
    const organizationId = query.organizationId === undefined ? undefined : uuid(query.organizationId).toLowerCase();
    return this.days.day(actorOf(request), projectOf(projectId), civilDay(dayValue), organizationId);
  }

  @Post("primary-days/:day/close")
  async close(@Req() request: ActorRequest, @Param("p") projectId: string, @Param("day") dayValue: string, @Query() query: Record<string, unknown>, @Body() body: unknown, @Res() response: any) {
    queryInput(query, []);
    const result = await this.days.close(actorOf(request), projectOf(projectId), civilDay(dayValue), body);
    response.status(result.status).json(result.body);
  }

  @Post("primary-days/:day/corrections")
  async correct(@Req() request: ActorRequest, @Param("p") projectId: string, @Param("day") dayValue: string, @Query() query: Record<string, unknown>, @Body() body: unknown, @Res() response: any) {
    queryInput(query, []);
    const result = await this.days.correct(actorOf(request), projectOf(projectId), civilDay(dayValue), body);
    response.status(result.status).json(result.body);
  }

  @Get("consolidated/:day")
  consolidated(@Req() request: ActorRequest, @Param("p") projectId: string, @Param("day") dayValue: string, @Query() query: Record<string, unknown>) {
    queryInput(query, []);
    return this.days.consolidated(actorOf(request), projectOf(projectId), civilDay(dayValue));
  }

  @Post("consolidated/:day/revisions")
  async issue(@Req() request: ActorRequest, @Param("p") projectId: string, @Param("day") dayValue: string, @Query() query: Record<string, unknown>, @Body() body: unknown, @Res() response: any) {
    queryInput(query, []);
    const result = await this.days.issue(actorOf(request), projectOf(projectId), civilDay(dayValue), body);
    response.status(result.status).json(result.body);
  }
}
