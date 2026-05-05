// Groq client wrapper. All functions here gracefully no-op (return null) if
// GROQ_API_KEY is not set, so the app keeps running on free tier without AI.

const GROQ_BASE = "https://api.groq.com/openai/v1";

function key(): string | null {
  return process.env.GROQ_API_KEY ?? null;
}

export function groqEnabled(): boolean {
  return key() !== null;
}

async function chat(opts: {
  model: string;
  system?: string;
  user: string;
  json?: boolean;
  maxTokens?: number;
  temperature?: number;
}): Promise<string | null> {
  const k = key();
  if (!k) return null;
  const messages: Array<{ role: string; content: string }> = [];
  if (opts.system) messages.push({ role: "system", content: opts.system });
  messages.push({ role: "user", content: opts.user });

  const body: Record<string, unknown> = {
    model: opts.model,
    messages,
    temperature: opts.temperature ?? 0.4,
    max_tokens: opts.maxTokens ?? 256,
  };
  if (opts.json) body.response_format = { type: "json_object" };

  const r = await fetch(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${k}`,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    console.error("groq chat", r.status, await r.text().catch(() => ""));
    return null;
  }
  const j = (await r.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return j.choices?.[0]?.message?.content?.trim() ?? null;
}

// ===== Whisper transcription =====
export async function transcribe(
  audio: Buffer,
  mime: string
): Promise<{ text: string; language: string } | null> {
  const k = key();
  if (!k) return null;
  const ext =
    mime.includes("mp4") ? "m4a" :
    mime.includes("mpeg") ? "mp3" :
    mime.includes("ogg") ? "ogg" :
    mime.includes("wav") ? "wav" : "webm";
  const blob = new Blob([new Uint8Array(audio)], { type: mime });
  const fd = new FormData();
  fd.append("file", blob, `audio.${ext}`);
  fd.append("model", "whisper-large-v3");
  fd.append("response_format", "verbose_json");
  fd.append("temperature", "0");

  const r = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${k}` },
    body: fd,
  });
  if (!r.ok) {
    console.error("groq transcribe", r.status, await r.text().catch(() => ""));
    return null;
  }
  const j = (await r.json()) as { text?: string; language?: string };
  if (!j.text) return null;
  return {
    text: j.text.trim().slice(0, 4000),
    language: (j.language ?? "unknown").slice(0, 16),
  };
}

// ===== moderation (Llama-Guard) =====
// Returns { ok: false, reason } if the content should be blocked.
export async function moderate(text: string): Promise<{ ok: boolean; reason?: string } | null> {
  if (!text.trim()) return { ok: true };
  // llama-guard-4-12b is Groq's hosted safety classifier as of 2025.
  // It returns "safe" or "unsafe\n<category>".
  const out = await chat({
    model: "meta-llama/llama-guard-4-12b",
    user: text,
    temperature: 0,
    maxTokens: 32,
  });
  if (out === null) return null;
  const first = out.split(/\s+/)[0]?.toLowerCase();
  if (first === "safe") return { ok: true };
  const reason = out.split("\n").slice(1).join(" ").trim().slice(0, 80) || "unsafe";
  return { ok: false, reason };
}

// ===== auto-title =====
export async function autoTitle(transcript: string): Promise<string | null> {
  if (!transcript.trim()) return null;
  const out = await chat({
    model: "llama-3.3-70b-versatile",
    system:
      "Write a 2-5 word evocative title for a short voice memo. Return ONLY the title, no quotes, no punctuation at the end.",
    user: transcript.slice(0, 1500),
    temperature: 0.7,
    maxTokens: 24,
  });
  if (!out) return null;
  return out.replace(/^["']|["']$/g, "").trim().slice(0, 40) || null;
}

// ===== vibe classification =====
export type Vibe = "joy" | "grief" | "awe" | "anger" | "calm" | "playful" | "mundane";
const VIBES: Vibe[] = ["joy", "grief", "awe", "anger", "calm", "playful", "mundane"];

export async function classifyVibe(transcript: string): Promise<Vibe | null> {
  if (!transcript.trim()) return null;
  const out = await chat({
    model: "llama-3.1-8b-instant",
    system: `Classify the emotional vibe of this voice memo into exactly ONE of: ${VIBES.join(", ")}. Reply with only the word, nothing else.`,
    user: transcript.slice(0, 1500),
    temperature: 0,
    maxTokens: 8,
  });
  const word = out?.toLowerCase().replace(/[^a-z]/g, "") as Vibe | undefined;
  return word && VIBES.includes(word) ? word : null;
}

// ===== translation =====
export async function translate(text: string, targetLang: string): Promise<string | null> {
  if (!text.trim()) return null;
  const out = await chat({
    model: "llama-3.3-70b-versatile",
    system: `Translate the user's text into ${targetLang}. Reply with ONLY the translation, no preface, no quotes.`,
    user: text.slice(0, 3000),
    temperature: 0.2,
    maxTokens: 1024,
  });
  return out?.slice(0, 4000) ?? null;
}

// ===== contextual record prompt =====
export async function recordPrompt(opts: {
  placeName?: string | null;
  recentTitles?: string[];
}): Promise<string | null> {
  const ctx: string[] = [];
  if (opts.placeName) ctx.push(`The location is near: ${opts.placeName}.`);
  if (opts.recentTitles && opts.recentTitles.length > 0) {
    ctx.push(`Recent Echoes here have been about: ${opts.recentTitles.slice(0, 5).join("; ")}.`);
  }
  if (ctx.length === 0) ctx.push("This is a new spot with no Echoes yet.");

  const out = await chat({
    model: "llama-3.1-8b-instant",
    system:
      "You suggest a one-sentence prompt to inspire someone to record a 60-second voice memo at this exact location. Be evocative, specific to the place, and under 18 words. No emoji. No quotes. Output the prompt only.",
    user: ctx.join(" "),
    temperature: 0.85,
    maxTokens: 60,
  });
  return out?.replace(/^["']|["']$/g, "").trim().slice(0, 200) ?? null;
}

// ===== famous-place context summary =====
export async function placeContext(opts: {
  placeName: string;
  transcripts: string[];
}): Promise<string | null> {
  if (opts.transcripts.length === 0) return null;
  const out = await chat({
    model: "llama-3.1-8b-instant",
    system:
      "In one sentence (under 22 words), describe the common themes of these voice memos left at a single location. No quotes. No preface.",
    user: `Place: ${opts.placeName}\n\n${opts.transcripts.slice(0, 8).map((t, i) => `${i + 1}. ${t.slice(0, 200)}`).join("\n")}`,
    temperature: 0.5,
    maxTokens: 80,
  });
  return out?.replace(/^["']|["']$/g, "").trim().slice(0, 220) ?? null;
}
