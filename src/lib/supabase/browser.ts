"use client";
import { createBrowserClient } from "@supabase/ssr";
import { env } from "@/lib/env";

let _client: ReturnType<typeof createBrowserClient> | null = null;

export function supabase() {
  if (_client) return _client;
  _client = createBrowserClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY);
  return _client;
}

/** Sign in anonymously if not already signed in. Returns user id. */
export async function ensureAnonUser(): Promise<string> {
  const sb = supabase();
  const { data: sess } = await sb.auth.getSession();
  if (sess.session?.user) return sess.session.user.id;
  const { data, error } = await sb.auth.signInAnonymously();
  if (error || !data.user) throw error ?? new Error("anon sign-in failed");
  return data.user.id;
}
