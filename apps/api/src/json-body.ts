import type { NestExpressApplication } from '@nestjs/platform-express';

const submissionUpload = /^\/api\/v1\/projects\/[0-9a-f-]{36}\/accepted-parts\/[0-9a-f-]{36}\/customer-submission\/(?:remarks\/[0-9a-f-]{36}\/photos|scans)\/?$/i;

export function configureJsonBody(app: NestExpressApplication) {
  app.useBodyParser('json', {
    limit: '12mb',
    type: (req) => req.method === 'POST' &&
      submissionUpload.test(req.url?.split('?')[0] ?? '') &&
      /^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] ?? ''),
  });
  app.useBodyParser('json', { limit: '2mb' });
}
