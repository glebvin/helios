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
import type { Pool } from "pg";
import type { PgBoss } from "pg-boss";
import { AuthService, TenantGuard, actorOf, type ActorRequest } from "./auth.service.js";
import { createPool } from "./db.js";
import { QUEUE_WORK_REPORT, createBoss, ensureQueue } from "./jobs.js";
import { collectReady, evidenceCheck, evidenceRoot, workerCheck } from "./ready.js";
import { WorkforceService } from "./workforce.service.js";
import { DirectorApiController, VersionedAuthController, ApiSpecController } from "./director-api.controller.js";
import { DirectorApiService } from "./director-api.service.js";
import { PeopleService } from "./people.service.js";
import { PeopleController } from "./people.controller.js";

import {TasksService} from "./tasks.service.js";
import {TasksController} from "./tasks.controller.js";
import {ExecutionService} from "./execution.service.js";
import {ExecutionController} from "./execution.controller.js";

import {TimeController} from './time.controller.js';
import {TimeService} from './time.service.js';
import {EvidenceController} from './evidence.controller.js';
import {EvidenceService} from './evidence.service.js';
import {EvidenceStorage} from './evidence-storage.js';

import {InvitationsService} from "./invitations.service.js";
import {InvitationsController} from "./invitations.controller.js";

export const APP_POOL = "APP_POOL";
export const BOSS = "BOSS";


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
class ReadyController {
  constructor(@Inject(APP_POOL) private readonly pool: Pool, @Inject(BOSS) private readonly boss: PgBoss) {}

  @Get("ready")
  async ready(@Res() response: { status: (code: number) => { json: (body: unknown) => void } }) {
    const report = await collectReady({
      db: () => this.pool.query("SELECT 1"),
      evidence: () => {
        try {
          return evidenceCheck(evidenceRoot());
        } catch {
          return Promise.resolve("missing");
        }
      },
      queue: async () => (await this.boss.getQueues()).some((queue) => queue.name === QUEUE_WORK_REPORT),
      worker: () => workerCheck(process.env.HELIOS_WORKER_HEARTBEAT, Date.now()),
    });
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
  controllers: [InvitationsController, AuthController, ReadyController, WorkforceController, DirectorApiController, VersionedAuthController, ApiSpecController, PeopleController, TasksController, ExecutionController, EvidenceController, TimeController],
  providers: [
    { provide: APP_POOL, useFactory: () => createPool() },
    BossHost,
    { provide: BOSS, useFactory: (host: BossHost) => host.boss, inject: [BossHost] },
    { provide: AuthService, useFactory: (pool: Pool) => new AuthService(pool), inject: [APP_POOL] },
    { provide: DirectorApiService, useFactory: (pool: Pool) => new DirectorApiService(pool), inject: [APP_POOL] },
    { provide: TasksService, useFactory: (pool:Pool,api:DirectorApiService,people:PeopleService) => new TasksService(pool,api,people), inject:[APP_POOL,DirectorApiService,PeopleService] },
    { provide: PeopleService, useFactory: (pool: Pool, api: DirectorApiService) => new PeopleService(pool,api), inject: [APP_POOL,DirectorApiService] },
    { provide: ExecutionService, useFactory: (pool:Pool,people:PeopleService) => new ExecutionService(pool,people), inject: [APP_POOL,PeopleService] },
    {
      provide: WorkforceService,
      useFactory: (pool: Pool, boss: PgBoss) => new WorkforceService(pool, boss),
      inject: [APP_POOL, BOSS],
    },
    {provide:TimeService,useFactory:(pool:Pool)=>new TimeService(pool),inject:[APP_POOL]},
    EvidenceStorage,
    {provide:EvidenceService,useFactory:(pool:Pool,storage:EvidenceStorage)=>new EvidenceService(pool,storage),inject:[APP_POOL,EvidenceStorage]},
    {provide:InvitationsService,useFactory:(pool:Pool)=>new InvitationsService(pool),inject:[APP_POOL]},
    TenantGuard,
  ],
})
export class AppModule implements OnModuleDestroy {
  constructor(@Inject(APP_POOL) private readonly pool: Pool) {}

  async onModuleDestroy() {
    await this.pool.end();
  }
}
