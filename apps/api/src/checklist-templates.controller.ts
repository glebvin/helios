import { Body, Controller, Get, Inject, Param, Post, Query, Req, Res, UseGuards } from "@nestjs/common";
import { actorOf, TenantGuard, type ActorRequest } from "./auth.service.js";
import { queryInput } from "./api-input.js";
import { httpError } from "./errors.js";
import { ChecklistTemplatesService } from "./checklist-templates.service.js";

type Response = { status(code: number): { json(body: unknown): void } };

@Controller("api/v1")
@UseGuards(TenantGuard)
export class ChecklistTemplatesController {
  constructor(@Inject(ChecklistTemplatesService) private readonly templates: ChecklistTemplatesService) {}

  @Get("checklist-templates")
  home(@Req() request: ActorRequest, @Query() query: Record<string, unknown>) {
    queryInput(query, ["projectId"]);
    return this.templates.list(actorOf(request), query.projectId === undefined ? undefined : String(query.projectId));
  }

  @Get("projects/:projectId/checklist-templates")
  project(@Req() request: ActorRequest, @Param("projectId") projectId: string, @Query() query: Record<string, unknown>) {
    queryInput(query, []);
    return this.templates.list(actorOf(request), projectId);
  }

  @Post("projects/:projectId/checklist-templates")
  async create(@Req() request: ActorRequest, @Param("projectId") projectId: string, @Body() body: unknown, @Res() response: Response) {
    const result = await this.templates.create(actorOf(request), projectId, body);
    response.status(result.status).json(result.body);
  }

  @Get("projects/:projectId/checklist-templates/:templateId")
  read(@Req() request: ActorRequest, @Param("projectId") projectId: string, @Param("templateId") templateId: string, @Query() query: Record<string, unknown>) {
    queryInput(query, ["edition"]);
    return this.templates.read(actorOf(request), projectId, templateId, editionOf(query.edition));
  }

  @Post("projects/:projectId/checklist-templates/:templateId")
  async save(@Req() request: ActorRequest, @Param("projectId") projectId: string, @Param("templateId") templateId: string, @Body() body: unknown, @Res() response: Response) {
    const result = await this.templates.save(actorOf(request), projectId, templateId, body);
    response.status(result.status).json(result.body);
  }

  @Post("projects/:projectId/checklist-templates/:templateId/submit")
  async submit(@Req() request: ActorRequest, @Param("projectId") projectId: string, @Param("templateId") templateId: string, @Body() body: unknown, @Res() response: Response) {
    const result = await this.templates.submit(actorOf(request), projectId, templateId, body);
    response.status(result.status).json(result.body);
  }

  @Post("projects/:projectId/checklist-templates/:templateId/decision")
  async decide(@Req() request: ActorRequest, @Param("projectId") projectId: string, @Param("templateId") templateId: string, @Body() body: unknown, @Res() response: Response) {
    const result = await this.templates.decide(actorOf(request), projectId, templateId, body);
    response.status(result.status).json(result.body);
  }
}

function editionOf(value: unknown) {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d{1,10}$/.test(value) || Number(value) < 1 || Number(value) > 2147483647) throw httpError(400, "invalid_version");
  return Number(value);
}
