import { NextResponse } from "next/server";

/** Wrap a route handler so any thrown error becomes a clean 500 with a safe message. */
export function safe<Args extends unknown[]>(
  fn: (...args: Args) => Promise<Response>
) {
  return async (...args: Args): Promise<Response> => {
    try {
      return await fn(...args);
    } catch (e) {
      const msg = process.env.NODE_ENV === "production"
        ? "internal error"
        : (e as Error).message ?? "internal error";
      return NextResponse.json({ error: msg }, { status: 500 });
    }
  };
}
