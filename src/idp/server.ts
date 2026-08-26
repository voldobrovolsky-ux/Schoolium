import { buildIdpApi } from "./app.js";
import { createDevelopmentOidcProvider } from "./oidc.js";
import { createRuntimeDependencies } from "../infrastructure/runtime.js";

const oidc = createDevelopmentOidcProvider();
const oidcPort = Number(process.env.OIDC_PORT ?? 4000);
const apiPort = Number(process.env.IDP_API_PORT ?? 4001);
const dependencies = await createRuntimeDependencies();
const api = buildIdpApi(undefined, dependencies);
api.addHook("onClose", async () => dependencies.close());

await Promise.all([
  new Promise<void>((resolve) => oidc.listen(oidcPort, "127.0.0.1", resolve)),
  api.listen({ port: apiPort, host: "127.0.0.1" }).then(() => undefined),
]);
