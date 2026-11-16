import { Body, Controller, Get, HttpCode, Inject, Post, Query, Req, Res, UseGuards, type CanActivate, type ExecutionContext } from "@nestjs/common";
import { actorOf, TenantGuard, type ActorRequest } from "./auth.service.js";
import { queryInput } from "./api-input.js";
import { StaffImportService } from "./staff-import.service.js";

type Response = { status(code: number): Response; json(body: unknown): unknown };

class StaffImportQueryGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (request.method !== "GET") queryInput(request.query ?? {}, []);
    return true;
  }
}

@Controller("api/v1")
@UseGuards(TenantGuard, StaffImportQueryGuard)
export class StaffImportController {
  constructor(@Inject(StaffImportService) private readonly imports: StaffImportService) {}

  @Post("staff-imports/checks")
  @HttpCode(200)
  check(@Req() request: ActorRequest, @Body() body: unknown) {
    return this.imports.check(actorOf(request), body);
  }

  @Post("staff-imports")
  async confirm(@Req() request: ActorRequest, @Body() body: unknown, @Res() response: Response) {
    const result = await this.imports.confirm(actorOf(request), body);
    return response.status(result.status).json(result.body);
  }

  @Get("staff-imports")
  list(@Req() request: ActorRequest, @Query() query: Record<string, unknown>) {
    queryInput(query, ["limit", "offset"]);
    return this.imports.list(actorOf(request), query);
  }
}
