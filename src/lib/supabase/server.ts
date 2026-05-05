import { createServerClient } from "@supabase/ssr";
import { createClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { env, serverEnv } from "@/lib/env";

/** Server client bound to the request's cookies (acts as the signed-in user). */
export async function supabaseRoute() {
  const store = await cookies();
  return createServerClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return store.getAll();
      },
      setAll(toSet) {
        for (const { name, value, options } of toSet) {
          store.set(name, value, options);
        }
      },
    },
  });
}

/** Service-role client. Bypasses RLS — use only in trusted server code. */
export function supabaseAdmin() {
  return createClient(env.SUPABASE_URL, serverEnv.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
