import "reflect-metadata";
import {
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  Module,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { AuthService, TenantGuard, actorOf, type ActorRequest } from "./auth.service.js";
import { appUrl, createPool } from "./db.js";
import { QUEUE_WORK_REPORT, createBoss, ensureQueue } from "./jobs.js";
import { cachedReadiness, evidenceCheck, evidenceRoot, workerCheck } from "./ready.js";
import { WorkforceService } from "./workforce.service.js";
import { DirectorApiController, VersionedAuthController, ApiSpecController } from "./director-api.controller.js";
import { DirectorApiService } from "./director-api.service.js";
import { PeopleService } from "./people.service.js";
import { PeopleController } from "./people.controller.js";
import { StaffImportService } from "./staff-import.service.js";
import { StaffImportController } from "./staff-import.controller.js";

import {TasksService} from "./tasks.service.js";
import {TasksController} from "./tasks.controller.js";
import {ExecutionService} from "./execution.service.js";
import {ExecutionController} from "./execution.controller.js";

import {TimeController} from './time.controller.js';
import {TimeService} from './time.service.js';
import {EvidenceController} from './evidence.controller.js';
import {EvidenceService} from './evidence.service.js';
import {EvidenceStorage,type EvidenceBlobStore} from './evidence-storage.js';
import {createEvidenceStore} from './evidence-store.js';

import {InvitationsService} from "./invitations.service.js";
import {InvitationsController} from "./invitations.controller.js";

import {RouteConfigService} from "./route-config.service.js";
import {RouteConfigController} from "./route-config.controller.js";
import {ResponsibilityOrdersService} from "./responsibility-orders.service.js";
import {ResponsibilityOrdersController} from "./responsibility-orders.controller.js";

export const APP_POOL = "APP_POOL";
export const BOSS = "BOSS";


@Injectable()
class BossHost implements OnModuleInit, OnModuleDestroy {
  readonly boss = createBoss();

  constructor() { this.boss.on("error", () => console.error("queue_unavailable")); }

  async onModuleInit() {
    await this.boss.start();
    await ensureQueue(this.boss);
  }

  async onModuleDestroy() {
    await this.boss.stop({ graceful: false });
  }
}


@Controller("api")
class AuthController {
  constructor(@Inject(AuthService) private readonly auth: AuthService) {}

  @Post("auth/login")
  login(@Body() body: unknown) {
    return this.auth.login(body);
  }

  @Get("health")
  health() {
    return { ok: true };
  }
}

@Controller("api")
class ReadyController implements OnModuleDestroy {
  // Readiness must not wait behind business traffic or exhaust its pool during an outage.
  private readonly pool = new Pool({connectionString: appUrl, max: 1,
    connectionTimeoutMillis: 1000, statement_timeout: 1000, query_timeout: 1000, idleTimeoutMillis: 10000});
  private readonly probe = cachedReadiness({
    requireWorker: process.env.NODE_ENV === "production",
    db: () => this.pool.query("SELECT 1"),
    evidence: () => evidenceCheck(evidenceRoot()),
    // createBoss uses the fixed default pgboss schema; read only the required queue.
    queue: async () => (await this.pool.query("SELECT EXISTS (SELECT 1 FROM pgboss.queue WHERE name = $1) AS present", [QUEUE_WORK_REPORT])).rows[0]?.present === true,
    worker: () => workerCheck(process.env.HELIOS_WORKER_HEARTBEAT, Date.now()),
  });
  constructor() { this.pool.on("error", () => {}); }
  async onModuleDestroy() { await this.pool.end(); }
  @Get("ready")
  async ready(@Res() response: { status: (code: number) => { json: (body: unknown) => void } }) {
    const report = await this.probe();
    response.status(report.ok ? 200 : 503).json(report);
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

  @Post("projects/:id/place")
  savePlace(
    @Req() request: ActorRequest,
    @Param("id") id: string,
    @Body() body: { address?: unknown; latitude?: unknown; longitude?: unknown },
  ) {
    return this.workforce.savePlace(actorOf(request), id, body);
  }

  @Post("tasks")
  createTask(@Req() request:ActorRequest,@Body() body:unknown) {
    return this.workforce.createTask(actorOf(request),body);
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

@Module({
  controllers: [ResponsibilityOrdersController, RouteConfigController, InvitationsController, AuthController, ReadyController, WorkforceController, DirectorApiController, VersionedAuthController, ApiSpecController, PeopleController, StaffImportController, TasksController, ExecutionController, EvidenceController, TimeController],
  providers: [
    { provide: APP_POOL, useFactory: () => createPool() },
    BossHost,
    { provide: BOSS, useFactory: (host: BossHost) => host.boss, inject: [BossHost] },
    { provide: AuthService, useFactory: (pool: Pool) => new AuthService(pool), inject: [APP_POOL] },
    { provide: DirectorApiService, useFactory: (pool: Pool) => new DirectorApiService(pool), inject: [APP_POOL] },
    { provide: TasksService, useFactory: (pool:Pool,api:DirectorApiService,people:PeopleService) => new TasksService(pool,api,people), inject:[APP_POOL,DirectorApiService,PeopleService] },
    { provide: PeopleService, useFactory: (pool: Pool, api: DirectorApiService) => new PeopleService(pool,api), inject: [APP_POOL,DirectorApiService] },
    { provide: StaffImportService, useFactory: (pool: Pool) => new StaffImportService(pool), inject: [APP_POOL] },
    { provide: ExecutionService, useFactory: (pool:Pool,people:PeopleService) => new ExecutionService(pool,people), inject: [APP_POOL,PeopleService] },
    {
      provide: WorkforceService,
      useFactory: (pool: Pool, boss: PgBoss) => new WorkforceService(pool, boss),
      inject: [APP_POOL, BOSS],
    },
    {provide:TimeService,useFactory:(pool:Pool)=>new TimeService(pool),inject:[APP_POOL]},
    // Shared DI: unset HELIOS_EVIDENCE_STORE keeps the filesystem adapter. S3 is opt-in for the QA store only.
    {provide:EvidenceStorage,useFactory:()=>createEvidenceStore()},
    {provide:EvidenceService,useFactory:(pool:Pool,storage:EvidenceBlobStore)=>new EvidenceService(pool,storage),inject:[APP_POOL,EvidenceStorage]},
    {provide:InvitationsService,useFactory:(pool:Pool)=>new InvitationsService(pool),inject:[APP_POOL]},
    {provide:RouteConfigService,useFactory:(pool:Pool)=>new RouteConfigService(pool),inject:[APP_POOL]},
    {provide:ResponsibilityOrdersService,useFactory:(pool:Pool)=>new ResponsibilityOrdersService(pool),inject:[APP_POOL]},
    TenantGuard,
  ],
})
export class AppModule implements OnModuleDestroy {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  async onModuleDestroy() {
    await this.pool.end();
  }
}
