import { buildSchooliumApp } from "./app.js";

const app = buildSchooliumApp();
const port = Number(process.env.SCHOOLIUM_PORT ?? 3000);

await app.listen({ port, host: "127.0.0.1" });
