import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import type { IncomingMessage, ServerResponse } from "node:http";
import { actorOf, TenantGuard, type ActorRequest } from "./auth.service.js";
import { queryInput, uuid } from "./api-input.js";
import { httpError } from "./errors.js";
import { ChecklistRunsService, readChecklistUpload } from "./checklist-runs.service.js";

type JsonResponse = { status(code: number): { json(body: unknown): void } };

@Controller("api/v1/projects/:projectId/tasks/:taskId")
@UseGuards(TenantGuard)
export class ChecklistRunsController {
  constructor(@Inject(ChecklistRunsService) private readonly runs: ChecklistRunsService) {}

  @Get("checklist-runs")
  list(@Req() request: ActorRequest, @Param("projectId") projectId: string, @Param("taskId") taskId: string, @Query() query: Record<string, unknown>) {
    queryInput(query, []);
    return this.runs.list(actorOf(request), id(projectId), id(taskId));
  }

  @Post("checklist-runs")
  async save(@Req() request: ActorRequest, @Param("projectId") projectId: string, @Param("taskId") taskId: string, @Body() body: unknown, @Query() query: Record<string, unknown>, @Res() response: JsonResponse) {
    queryInput(query, []);
    const result = await this.runs.save(actorOf(request), id(projectId), id(taskId), body);
    response.status(result.status).json(result.body);
  }

  @Post("checklist-files")
  async upload(@Req() request: ActorRequest & IncomingMessage, @Param("projectId") projectId: string, @Param("taskId") taskId: string, @Query() query: Record<string, unknown>, @Res() response: JsonResponse) {
    queryInput(query, ["requestId", "itemId", "filename", "contentType"]);
    for (const key of ["requestId", "itemId", "filename", "contentType"]) if (typeof query[key] !== "string") throw httpError(400, "invalid_query");
    const bytes = await readChecklistUpload(request);
    const result = await this.runs.upload(actorOf(request), id(projectId), id(taskId), { requestId: query.requestId, itemId: query.itemId, filename: query.filename, contentType: query.contentType, bytes });
    response.status(result.status).json(result.body);
  }

  @Get("checklist-files/:fileId")
  async download(@Req() request: ActorRequest, @Param("projectId") projectId: string, @Param("taskId") taskId: string, @Param("fileId") fileId: string, @Query() query: Record<string, unknown>, @Res() response: ServerResponse) {
    queryInput(query, []);
    const file = await this.runs.download(actorOf(request), id(projectId), id(taskId), id(fileId));
    response.setHeader("Content-Type", file.contentType);
    response.setHeader("X-Content-Type-Options", "nosniff");
    const ascii = file.filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
    response.setHeader("Content-Disposition", `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`);
    response.setHeader("Cache-Control", "private, no-store");
    response.statusCode = 200;
    response.end(file.bytes);
  }
}

function id(value: string) {
  return uuid(value).toLowerCase();
}
