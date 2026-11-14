import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module.js";
import { AllExceptionsFilter } from "./http.js";

import {authProtection, bindAuthProtection} from "./auth-protection.js";

const app = await NestFactory.create(AppModule);
const protection = authProtection();
bindAuthProtection(protection);
app.use(protection);
app.enableCors({
  origin: ["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:5184", "http://localhost:5184"],
  allowedHeaders: ["content-type", "authorization", "x-tenant-id"],
});
app.useGlobalFilters(new AllExceptionsFilter());
const port = Number(process.env.API_PORT ?? 4317);
await app.listen(port, "127.0.0.1");
console.log(`api http://127.0.0.1:${port}`);
