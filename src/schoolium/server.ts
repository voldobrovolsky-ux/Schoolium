import { buildSchooliumApp } from "./app.js";
import { createRuntimeDependencies } from "../infrastructure/runtime.js";

const dependencies = await createRuntimeDependencies();
const app = buildSchooliumApp(undefined, dependencies);
app.addHook("onClose", async () => dependencies.close());
const port = Number(process.env.SCHOOLIUM_PORT ?? 3000);

await app.listen({ port, host: "127.0.0.1" });
