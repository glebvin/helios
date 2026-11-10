import 'reflect-metadata';
import {NestFactory} from '@nestjs/core';
import {AppModule} from '../../apps/api/src/app.module.js';
import {authProtection} from '../../apps/api/src/auth-protection.js';
import {AllExceptionsFilter} from '../../apps/api/src/http.js';

// A staging-only entry point. The development entry used by Cursor is untouched.
const app = await NestFactory.create(AppModule);
app.use(authProtection());
app.useGlobalFilters(new AllExceptionsFilter());
app.enableShutdownHooks();
await app.listen(4327, '0.0.0.0');
