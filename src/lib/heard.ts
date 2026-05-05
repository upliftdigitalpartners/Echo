"use client";

const KEY = "echo:heard";
const MAX = 500;

function read(): Set<string> {
  if (typeof localStorage === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr.slice(-MAX) : []);
  } catch {
    return new Set();
  }
}
function write(s: Set<string>) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(KEY, JSON.stringify([...s].slice(-MAX)));
  } catch {
    /* quota — drop silently */
  }
}

export function hasHeard(id: string): boolean {
  return read().has(id);
}
export function markHeard(id: string): void {
  const s = read();
  s.add(id);
  write(s);
}
