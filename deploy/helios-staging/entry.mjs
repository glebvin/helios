import 'reflect-metadata';
import {NestFactory} from '@nestjs/core';
import {AppModule} from '../../apps/api/src/app.module.js';
import {authProtection, bindAuthProtection} from '../../apps/api/src/auth-protection.js';
import {AllExceptionsFilter} from '../../apps/api/src/http.js';

// A staging-only entry point. The development entry used by Cursor is untouched.
// Creating the protection also installs it; bind keeps login limited if this file is the process entry.
const app = await NestFactory.create(AppModule, { bodyParser: false });
app.useBodyParser('json', { limit: '2mb' });
const protection = authProtection();
bindAuthProtection(protection);
app.use(protection);
app.useGlobalFilters(new AllExceptionsFilter());
app.enableShutdownHooks();
await app.listen(4327, '0.0.0.0');
