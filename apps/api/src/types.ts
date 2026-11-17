export interface Env {
  DB: D1Database;
  AUTH_TOKENS: KVNamespace;
  ASSETS?: Fetcher;
  CLICK_LIMITER?: RateLimit;
  API_LIMITER?: RateLimit;
  API_KEY?: string;
  INITIAL_TOKEN?: string;
  FALLBACK_URL?: string;
  OWN_HOSTNAMES?: string;
  ANALYTICS_ENABLED?: string;
  ANALYTICS_DIMENSIONS?: string;
  BRANDING_EXTERNAL_LINKS?: string;
}

export type PrincipalKind = "env" | "token" | "initial";

export interface Principal {
  kind: PrincipalKind;
  id: string;
  name: string;
}

export interface AppVariables {
  principal?: Principal;
}

export interface AppContext {
  Bindings: Env;
  Variables: AppVariables;
}
