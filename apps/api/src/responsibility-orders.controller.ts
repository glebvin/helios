import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { actorOf, TenantGuard, type ActorRequest } from "./auth.service.js";
import { queryInput } from "./api-input.js";
import { ResponsibilityOrdersService } from "./responsibility-orders.service.js";

@Controller("api/v1/responsibility-orders")
@UseGuards(TenantGuard)
export class ResponsibilityOrdersController {
  constructor(@Inject(ResponsibilityOrdersService) private readonly orders: ResponsibilityOrdersService) {}

  @Get("applicability")
  applicability(@Req() request: ActorRequest, @Query() query: Record<string, unknown>) {
    return this.orders.applicability(actorOf(request), query);
  }

  @Get()
  list(@Req() request: ActorRequest, @Query() query: Record<string, unknown>) {
    queryInput(query, ["projectId"]);
    return this.orders.list(actorOf(request), query.projectId === undefined ? undefined : String(query.projectId));
  }

  @Get(":id")
  read(@Req() request: ActorRequest, @Param("id") id: string) {
    return this.orders.read(actorOf(request), id);
  }

  @Post()
  async create(@Req() request: ActorRequest, @Body() body: unknown, @Res() response: { status: (code: number) => { json: (body: unknown) => void } }) {
    const result = await this.orders.create(actorOf(request), body);
    response.status(result.status).json(result.body);
  }

  @Post(":id/revoke")
  async revoke(@Req() request: ActorRequest, @Param("id") id: string, @Body() body: unknown, @Res() response: { status: (code: number) => { json: (body: unknown) => void } }) {
    const result = await this.orders.revoke(actorOf(request), id, body);
    response.status(result.status).json(result.body);
  }

  @Post(":id")
  async correct(@Req() request: ActorRequest, @Param("id") id: string, @Body() body: unknown, @Res() response: { status: (code: number) => { json: (body: unknown) => void } }) {
    const result = await this.orders.correct(actorOf(request), id, body);
    response.status(result.status).json(result.body);
  }
}
