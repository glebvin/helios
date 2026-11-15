import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { AppModule } from "./app.module.js";
import { AllExceptionsFilter } from "./http.js";

import {authProtection, bindAuthProtection} from "./auth-protection.js";

const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
app.useBodyParser("json", { limit: "2mb" });
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
