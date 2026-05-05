import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";

const SALT = "echo-v1-rate"; // not secret; only purpose is privacy of stored IPs

/** Derive a stable, non-PII key for the requester (IP + user-agent prefix). */
export function actorKey(req: Request): string {
  const xff = req.headers.get("x-forwarded-for") ?? "";
  const ip = xff.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "0.0.0.0";
  const ua = (req.headers.get("user-agent") ?? "").slice(0, 64);
  return createHash("sha256").update(`${SALT}|${ip}|${ua}`).digest("hex").slice(0, 32);
}

/** Returns true if the action is allowed (and records it), false if rate-limited. */
export async function rateAllow(
  req: Request,
  action: "pin.create" | "pin.listen" | "pin.report",
  limits: { max: number; windowSeconds: number }
): Promise<boolean> {
  const admin = supabaseAdmin();
  const { data, error } = await admin.rpc("rate_check", {
    p_actor: actorKey(req),
    p_action: action,
    p_max: limits.max,
    p_window_seconds: limits.windowSeconds,
  });
  if (error) {
    // Fail open on infra errors — better than wedging legitimate users.
    console.error("rate_check failed", error.message);
    return true;
  }
  return data === true;
}

export const LIMITS = {
  PIN_CREATE: { max: 10, windowSeconds: 3600 }, // 10/hour
  PIN_LISTEN: { max: 60, windowSeconds: 60 },   // 60/minute
  PIN_REPORT: { max: 20, windowSeconds: 3600 }, // 20/hour
} as const;
