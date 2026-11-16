import "@supabase/functions-js/edge-runtime.d.ts";
import { createHandler } from "./handler.mjs";

// Microsoft access tokens are verified by the handler, not the Supabase gateway.
Deno.serve(createHandler({
  supabaseUrl: Deno.env.get("SUPABASE_URL") || "",
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "",
  tenantId: Deno.env.get("WC_ENTRA_TENANT_ID") || Deno.env.get("ENTRA_TENANT_ID") || "",
  clientId: Deno.env.get("WC_ENTRA_CLIENT_ID") || Deno.env.get("ENTRA_CLIENT_ID") || "",
  origins: (Deno.env.get("WC_ALLOWED_ORIGINS") || Deno.env.get("ALLOWED_ORIGINS") || "https://kirilvassev-jpg.github.io,http://localhost:3000,http://127.0.0.1:3000").split(",").map(s => s.trim())
}));
