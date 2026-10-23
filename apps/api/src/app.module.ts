import "reflect-metadata";
import { Module } from "@nestjs/common";
import { id } from "@album/server-core";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { bindContractHttp } from "./http/contract-http";
import type { ApiRuntime } from "./http/runtime";
export class AppModule {}
Module({})(AppModule);
export async function createApplication(runtime: ApiRuntime) {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: false,
      bodyLimit: 32 * 1024 * 1024,
      routerOptions: { maxParamLength: 4096 },
    }),
    { logger: false },
  );
  app.useGlobalFilters({
    catch(error: any, host: any) {
      const reply = host.switchToHttp().getResponse(),
        status = error.getStatus?.() ?? error.statusCode ?? 500,
        requestId = id();
      reply
        .header("X-Request-Id", requestId)
        .header("Cache-Control", "no-store")
        .status(status)
        .send({
          error: {
            code: "REQUEST_REJECTED",
            message: "REQUEST_REJECTED",
            retryable: status >= 500,
            details: {},
          },
          requestId,
        });
    },
  });
  await bindContractHttp(app, runtime);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
