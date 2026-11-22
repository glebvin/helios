import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import { actorOf, TenantGuard, type ActorRequest } from './auth.service.js';
import { ContractPriceService } from './contract-prices.service.js';

@Controller('api/v1/contract-prices')
@UseGuards(TenantGuard)
export class ContractPriceProjectController {
  constructor(@Inject(ContractPriceService) private readonly prices: ContractPriceService) {}

  @Get('projects')
  projects(@Req() request: ActorRequest) {
    return this.prices.projects(actorOf(request));
  }
}

@Controller('api/v1/projects/:projectId/contract-prices')
@UseGuards(TenantGuard)
export class ContractPriceController {
  constructor(@Inject(ContractPriceService) private readonly prices: ContractPriceService) {}

  @Get()
  read(@Req() request: ActorRequest, @Param('projectId') projectId: string) {
    return this.prices.read(actorOf(request), projectId);
  }

  @Post('checks')
  @HttpCode(200)
  check(@Req() request: ActorRequest, @Param('projectId') projectId: string, @Body() body: unknown) {
    return this.prices.checkImport(actorOf(request), projectId, body);
  }

  @Post('imports')
  async importPrices(@Req() request: ActorRequest, @Param('projectId') projectId: string, @Body() body: unknown, @Res() response: { status: (code: number) => { json: (value: unknown) => void } }) {
    const result = await this.prices.importPrices(actorOf(request), projectId, body);
    response.status(result.status).json(result.body);
  }

  @Post()
  async save(@Req() request: ActorRequest, @Param('projectId') projectId: string, @Body() body: unknown, @Res() response: { status: (code: number) => { json: (value: unknown) => void } }) {
    const result = await this.prices.save(actorOf(request), projectId, body);
    response.status(result.status).json(result.body);
  }
}
