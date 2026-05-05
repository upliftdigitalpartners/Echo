"use client";

import { useEffect } from "react";

export type ToastData = {
  id: string;
  title: string;
  body?: string;
  onClick?: () => void;
};

export default function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastData | null;
  onDismiss: () => void;
}) {
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(onDismiss, 6000);
    return () => clearTimeout(t);
  }, [toast, onDismiss]);

  if (!toast) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-16 z-[700] flex justify-center px-4">
      <button
        onClick={() => {
          toast.onClick?.();
          onDismiss();
        }}
        className="pointer-events-auto flex max-w-sm items-center gap-3 rounded-2xl bg-amber-400/95 px-4 py-3 text-left text-black shadow-2xl ring-1 ring-amber-500"
      >
        <span className="text-xl">🎧</span>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{toast.title}</p>
          {toast.body && <p className="text-xs opacity-80">{toast.body}</p>}
        </div>
      </button>
    </div>
  );
}
