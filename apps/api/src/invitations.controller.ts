import {Body,Controller,Get,Inject,Param,Post,Req,UseGuards} from '@nestjs/common';
import {TenantGuard,actorOf,type ActorRequest} from './auth.service.js';
import {InvitationsService} from './invitations.service.js';

@Controller('api/v1')
export class InvitationsController {
  constructor(@Inject(InvitationsService) private readonly invitations:InvitationsService){}
  @Post('invitations') @UseGuards(TenantGuard)
  create(@Req() req:ActorRequest,@Body() body:unknown){return this.invitations.create(actorOf(req),body);}
  @Get('projects/:id/invitations') @UseGuards(TenantGuard)
  list(@Req() req:ActorRequest,@Param('id') id:string){return this.invitations.list(actorOf(req),id);}
  @Post('invitations/:id/refresh') @UseGuards(TenantGuard)
  refresh(@Req() req:ActorRequest,@Param('id') id:string,@Body() body:unknown){return this.invitations.refresh(actorOf(req),id,body);}
  @Get('join/:code')
  inspect(@Param('code') code:string){return this.invitations.inspect(code);}
  @Post('join/:code/challenge')
  challenge(@Param('code') code:string,@Body() body:unknown){return this.invitations.challenge(code,body);}
  @Post('join/:code')
  accept(@Param('code') code:string,@Body() body:unknown){return this.invitations.accept(code,body);}
}
