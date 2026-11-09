import { Body, Controller, Get, Inject, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { readFile } from "node:fs/promises";
import { AuthService, TenantGuard, actorOf, type ActorRequest } from "./auth.service.js";
import { DirectorApiService } from "./director-api.service.js";
import { day, page, queryInput, uuid } from "./api-input.js";

@Controller("api/v1/auth")
export class VersionedAuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}
  @Post("login")
  login(@Body() body: unknown) { return this.auth.login(body); }
  @Post("logout")
  @UseGuards(TenantGuard)
  logout(@Req() request: ActorRequest) { return this.auth.logout(request.sessionToken!); }
}

@Controller("api/v1")
export class ApiSpecController {
  @Get("openapi.json")
  async spec() { return JSON.parse(await readFile(new URL("../openapi.json", import.meta.url), "utf8")); }
}

@Controller("api/v1")
@UseGuards(TenantGuard)
export class DirectorApiController {
  constructor(@Inject(DirectorApiService) private readonly api: DirectorApiService) {}
  @Get("me")
  me(@Req() request: ActorRequest) { return this.api.me(actorOf(request)); }
  @Get("projects")
  projects(@Req() request: ActorRequest, @Query() query: Record<string, unknown>) {
    queryInput(query, ["limit", "offset"]);
    return this.api.projects(actorOf(request), page(query));
  }
  @Get("projects/:id")
  project(@Req() request: ActorRequest, @Param("id") id: string) { return this.api.project(actorOf(request), uuid(id)); }
  @Get("projects/:id/tasks")
  tasks(@Req() request: ActorRequest, @Param("id") id: string, @Query() query: Record<string, unknown>) {
    queryInput(query, ["limit", "offset", "day"]);
    return this.api.tasks(actorOf(request), uuid(id), page(query), day(query.day));
  }
  @Get("employees")
  employees(@Req() request: ActorRequest, @Query() query: Record<string, unknown>) {
    queryInput(query, ["limit", "offset", "projectId"]);
    return this.api.employees(actorOf(request), page(query), query.projectId === undefined ? undefined : uuid(query.projectId));
  }
  @Get("employees/:id")
  employee(@Req() request: ActorRequest, @Param("id") id: string) { return this.api.employee(actorOf(request), uuid(id)); }
  @Get("overview")
  overview(@Req() request: ActorRequest, @Query() query: Record<string, unknown>) {
    queryInput(query, ["day", "projectId"]);
    return this.api.overview(actorOf(request), query.projectId === undefined ? undefined : uuid(query.projectId), day(query.day));
  }
}
