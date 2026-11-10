import 'reflect-metadata';
import {NestFactory} from '@nestjs/core';
import {AppModule} from '../../apps/api/src/app.module.js';
import {AllExceptionsFilter} from '../../apps/api/src/http.js';

// A staging-only entry point. The development entry used by Cursor is untouched.
const app = await NestFactory.create(AppModule);
let attempts = 0;
let windowEnd = Date.now() + 60_000;
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'POST' && ['/api/auth/login','/api/v1/auth/login'].includes(req.path)) {
    if (Date.now() >= windowEnd) { attempts = 0; windowEnd = Date.now() + 60_000; }
    if (++attempts > 30) {
      res.setHeader('Retry-After', Math.max(1,Math.ceil((windowEnd-Date.now())/1000)));
      return res.status(429).json({error:'login_rate_limited'});
    }
  }
  next();
});
app.useGlobalFilters(new AllExceptionsFilter());
app.enableShutdownHooks();
await app.listen(4327, '0.0.0.0');
