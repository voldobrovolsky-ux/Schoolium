import { Provider } from "oidc-provider";

const issuer = process.env.IDP_ISSUER ?? "http://127.0.0.1:4000";
const schooliumRedirectUri = process.env.SCHOOLIUM_REDIRECT_URI ?? "http://127.0.0.1:3000/auth/callback";

/**
 * Standards-compliant protocol engine. Production account lookup, persistence,
 * key management, and interactions cannot be enabled before the corresponding
 * owner decisions are accepted; the development interaction is never enabled
 * by a production process.
 */
export const createDevelopmentOidcProvider = (): Provider => {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Production OIDC configuration requires persistent adapter, approved key management, and account interactions");
  }

  return new Provider(issuer, {
    clients: [
      {
        client_id: "schoolium",
        redirect_uris: [schooliumRedirectUri],
        response_types: ["code"],
        grant_types: ["authorization_code", "refresh_token"],
        token_endpoint_auth_method: "none",
      },
    ],
    claims: {
      openid: ["sub"],
      profile: ["given_name", "family_name", "middle_name", "birthdate", "locale"],
      email: ["email", "email_verified"],
      phone: ["phone_number", "phone_number_verified"],
    },
    features: {
      devInteractions: { enabled: true },
      introspection: { enabled: true },
      revocation: { enabled: true },
      resourceIndicators: { enabled: true },
      rpInitiatedLogout: { enabled: true },
    },
    routes: {
      authorization: "/authorize",
      token: "/token",
      userinfo: "/userinfo",
      revocation: "/revoke",
      introspection: "/introspect",
      end_session: "/end-session",
      jwks: "/.well-known/jwks.json",
    },
    pkce: {
      required: () => true,
    },
    findAccount: async (_ctx, accountId) => ({
      accountId,
      claims: async () => ({ sub: accountId }),
    }),
  });
};
