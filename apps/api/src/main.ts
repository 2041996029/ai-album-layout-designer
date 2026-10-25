import { createRuntime } from "./runtime";
import { createApplication } from "./app.module";
const { runtime, close } = await createRuntime();
const app = await createApplication(runtime);
const port = Number(process.env.C3_PORT ?? 3001);
await app.listen(port, process.env.C3_BIND_ADDRESS ?? "127.0.0.1");
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    await app.close();
    await close();
    process.exit(0);
  });
console.info(
  `C3 API ready on port ${port}; external integrations remain capability-gated.`,
);
