// Lazy env getters so `next build`'s page-data collection doesn't crash
// when running without a .env.local (e.g. during static analysis / CI without
// secrets). The actual throws happen at request time.

function need(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing env: ${name}. See .env.example`);
  return value;
}

export const env = {
  get SUPABASE_URL() {
    return need("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get SUPABASE_ANON_KEY() {
    return need("NEXT_PUBLIC_SUPABASE_ANON_KEY", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  },
};

export const serverEnv = {
  get SUPABASE_SERVICE_ROLE_KEY() {
    return need("SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY);
  },
};

export const LISTEN_RADIUS_M = Number(
  process.env.NEXT_PUBLIC_LISTEN_RADIUS_M ?? "50"
);
