import "reflect-metadata";
import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Inject,
  Injectable,
  Module,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { AuthService } from "./auth.service.js";
import { createPool } from "./db.js";
import { httpError } from "./errors.js";
import { createBoss, ensureQueue } from "./jobs.js";
import { WorkforceService, type Actor } from "./workforce.service.js";

export const APP_POOL = "APP_POOL";
export const BOSS = "BOSS";

type ActorRequest = { headers: Record<string, string | undefined>; actor?: Actor };

@Injectable()
class BossHost implements OnModuleInit, OnModuleDestroy {
  readonly boss = createBoss();

  async onModuleInit() {
    await this.boss.start();
    await ensureQueue(this.boss);
  }

  async onModuleDestroy() {
    await this.boss.stop({ graceful: false });
  }
}

@Injectable()
class TenantGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<ActorRequest>();
    const token = (request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const tenantId = request.headers["x-tenant-id"] ?? "";
    if (!token) throw httpError(401, "unauthorized");
    const actor = await this.auth.actor(token, tenantId);
    if (!actor) throw httpError(403, "tenant_denied");
    request.actor = actor;
    return true;
  }
}

@Controller("api")
class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post("auth/login")
  login(@Body() body: { email?: string; password?: string }) {
    return this.auth.login(body.email ?? "", body.password ?? "");
  }

  @Get("health")
  health() {
    return { ok: true };
  }
}

@Controller("api")
@UseGuards(TenantGuard)
class WorkforceController {
  constructor(@Inject(WorkforceService) private readonly workforce: WorkforceService) {}

  @Get("summary")
  summary(@Req() request: ActorRequest) {
    return this.workforce.summary(actorOf(request));
  }

  @Get("desk")
  desk(@Req() request: ActorRequest) {
    return this.workforce.desk(actorOf(request));
  }

  @Get("employees/:id")
  employee(@Req() request: ActorRequest, @Param("id") id: string) {
    return this.workforce.employee(actorOf(request), id);
  }

  @Post("tasks")
  createTask(
    @Req() request: ActorRequest,
    @Body() body: { title?: string; employeeId?: string; plannedQuantity?: string; unit?: string; workDate?: string },
  ) {
    return this.workforce.createTask(actorOf(request), {
      title: body.title ?? "",
      employeeId: body.employeeId ?? "",
      plannedQuantity: body.plannedQuantity ?? "",
      unit: body.unit ?? "",
      workDate: body.workDate ?? "",
    });
  }

  @Post("sync/events")
  sync(@Req() request: ActorRequest, @Body() body: { events?: Parameters<WorkforceService["sync"]>[1] }) {
    return this.workforce.sync(actorOf(request), body.events ?? []);
  }

  @Post("reports/:id/accept")
  accept(@Req() request: ActorRequest, @Param("id") id: string, @Body() body: { acceptedQuantity?: string }) {
    return this.workforce.accept(actorOf(request), id, body.acceptedQuantity ?? "");
  }

  @Get("files/:id")
  file(@Req() request: ActorRequest, @Param("id") id: string) {
    return this.workforce.file(actorOf(request), id);
  }
}

function actorOf(request: ActorRequest): Actor {
  if (!request.actor) throw httpError(403, "tenant_denied");
  return request.actor;
}

@Module({
  controllers: [AuthController, WorkforceController],
  providers: [
    { provide: APP_POOL, useFactory: () => createPool() },
    BossHost,
    { provide: BOSS, useFactory: (host: BossHost) => host.boss, inject: [BossHost] },
    { provide: AuthService, useFactory: (pool: Pool) => new AuthService(pool), inject: [APP_POOL] },
    {
      provide: WorkforceService,
      useFactory: (pool: Pool, boss: PgBoss) => new WorkforceService(pool, boss),
      inject: [APP_POOL, BOSS],
    },
    TenantGuard,
  ],
})
export class AppModule implements OnModuleDestroy {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  async onModuleDestroy() {
    await this.pool.end();
  }
}
