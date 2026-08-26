import { buildIdpApi } from "./app.js";
import { createDevelopmentOidcProvider } from "./oidc.js";

const oidc = createDevelopmentOidcProvider();
const oidcPort = Number(process.env.OIDC_PORT ?? 4000);
const apiPort = Number(process.env.IDP_API_PORT ?? 4001);
const api = buildIdpApi();

await Promise.all([
  new Promise<void>((resolve) => oidc.listen(oidcPort, "127.0.0.1", resolve)),
  api.listen({ port: apiPort, host: "127.0.0.1" }).then(() => undefined),
]);
