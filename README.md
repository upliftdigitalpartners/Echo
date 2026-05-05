# Echo

Voice messages locked to GPS coordinates. Drop a 60-second audio memo at any spot on Earth — only someone physically standing there can play it back.

PWA, Next.js 16, Supabase (Postgres + PostGIS + Storage), Leaflet + OpenStreetMap. Designed to run on free tiers end-to-end.

## How it works

- **Drop**: tap a button, record up to 60s, the pin is stamped at your current GPS.
- **Listen**: tap a pin on the map. The server checks your live coordinates against the pin's coordinates with PostGIS. If you're within `LISTEN_RADIUS_M` (default 50m), it mints a 60-second signed URL and the audio plays. Otherwise it tells you how far you are.
- **Report**: a pin auto-hides after 3 unique reports.
- **Auth**: anonymous — first visit calls `signInAnonymously()`. No accounts, no passwords.

Audio is stored in a private bucket. There is no public read URL — every playback is brokered by the server-side proximity check.

## Setup

### 1. Create a Supabase project

1. Sign up at https://supabase.com (free tier is fine).
2. Create a new project. Wait for it to finish provisioning.
3. Open the **SQL editor**, paste the contents of [`supabase/schema.sql`](supabase/schema.sql), run it. This installs PostGIS, creates `pins` + `reports` tables, RLS policies, RPC functions, and the private `audio` storage bucket.
4. **Settings → Authentication → Sign In / Up** — toggle **Enable anonymous sign-ins** on.
5. **Settings → API** — copy:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key (under "Project API keys") → `SUPABASE_SERVICE_ROLE_KEY`

### 2. Configure env

```bash
cp .env.example .env.local
# then paste the three values into .env.local
```

### 3. Run locally

```bash
npm install
npm run dev
```

Open http://localhost:3000. **Microphone and geolocation only work on `localhost` or HTTPS** — Chrome/Safari will silently refuse on plain HTTP otherwise.

### 4. Deploy to Vercel (free)

```bash
npm i -g vercel
vercel
```

Add the three env vars in **Vercel → Project → Settings → Environment Variables**, then redeploy. The PWA is installable on iOS Safari (Share → Add to Home Screen) and Android Chrome (Install app).

## Tuning

| Variable | Default | Effect |
|---|---|---|
| `NEXT_PUBLIC_LISTEN_RADIUS_M` | `50` | How close (meters) a listener must be to a pin to hear it. |

## Limits & honest caveats

- **GPS spoofing**: browser geolocation can be faked with devtools. The server-side distance check prevents the trivial "give me any audio file" attack, but a determined user can still send fake-but-plausible coordinates. Real anti-spoofing requires native iOS/Android APIs and is out of scope for this free-tier build.
- **Audio moderation**: no automated content moderation. Users can report; 3 reports auto-hide a pin. For scale you'd want a real moderation pipeline (paid).
- **Storage**: Supabase free tier is 1 GB → ~1,400 pins at 60s opus (~700 KB each). The `mp4` fallback (Safari) is larger. Plan accordingly.
- **Bbox query cap**: requests are capped at a 5° × 5° bounding box and 500 results to keep the free DB happy. Zoom in to see pins.
- **Browser support**: requires `MediaRecorder`, `getUserMedia`, and `navigator.geolocation`. Safari ≥ 14, Chrome/Edge/Firefox modern. Safari records to `audio/mp4`; everyone else records to `audio/webm;opus`.

## Project layout

```
src/
  app/
    api/pins/route.ts                # GET (bbox) + POST (create)
    api/pins/[id]/route.ts           # DELETE (own pins)
    api/pins/[id]/listen/route.ts    # POST: server-side proximity check → signed URL
    api/pins/[id]/report/route.ts    # POST: report a pin
    page.tsx, layout.tsx, globals.css
  components/
    EchoApp.tsx                      # Top-level client wiring
    MapView.tsx                      # Leaflet (dynamic import)
    Recorder.tsx                     # MediaRecorder UI
    Listener.tsx                     # Proximity-gated playback
    Modal.tsx, RegisterSW.tsx
  lib/
    api.ts                           # Client → /api wrappers
    geo.ts                           # Haversine, bbox validation
    geolocation.ts                   # navigator.geolocation helpers
    env.ts                           # Lazy env getters
    supabase/{browser,server}.ts
public/
  manifest.webmanifest, sw.js, icon-192.png, icon-512.png
supabase/
  schema.sql                         # Run this once in the SQL editor
scripts/
  gen-icons.mjs                      # Regenerate PWA icons (no deps)
```
