# MediMind AI — Multimodal Generative AI Doctor

Educational, **non-diagnostic** health-assessment assistant. Accepts text, photos, voice and lab reports and returns a structured, plain-language assessment.

- **Frontend:** plain static HTML + CSS + vanilla JS modules (your Stitch design, unchanged). No build step.
- **Backend:** 100% Supabase — Auth, Postgres + RLS, private Storage, Edge Functions (Deno).
- **AI:** **Groq** (Llama vision model for text + photos, Whisper for speech), called **only** from Edge Functions. The key lives in Supabase secrets.

## How your design maps to the pages

| Design view | Page |
|---|---|
| Landing + live safety demo | `index.html` |
| Symptom intake (3 steps) | `text.html` |
| Photo intake | `image.html` |
| Voice intake | `voice.html` |
| Lab report | `report.html` |
| Analyzing state | built into every intake page |
| Results + follow-up chat | `results.html?id=…` |
| History / dashboard | `dashboard.html` |
| Auth | `login.html`, `register.html` |

Changes made so nothing is fake: the sample data (IMG_02 preview, CBC table, demo history, canned chat) is gone; the **"Sample Results"** nav item became **"Lab Reports"**; every button now does its real job.

## Setup (Windows, PowerShell)

Prerequisites: Node 18+, a Supabase account, a [Groq API key](https://console.groq.com/keys).

```powershell
# 1. Install the Supabase CLI and log in
npm i -g supabase          # or: scoop install supabase
supabase login

# 2. Create a project at supabase.com, then link it (ref is in the project URL)
cd medimind
supabase link --project-ref YOUR_PROJECT_REF

# 3. Database, RLS, storage buckets, pgvector
supabase db push

# 4. Secrets (never put these in the frontend)
supabase secrets set GROQ_API_KEY=YOUR_GROQ_KEY
# optional overrides (check console.groq.com/docs/models if a model is retired):
# supabase secrets set GROQ_VISION_MODEL=qwen/qwen3.6-27b GROQ_TEXT_MODEL=<text model> GROQ_STT_MODEL=whisper-large-v3 RATE_LIMIT_PER_HOUR=20

# 5. Deploy all Edge Functions
supabase functions deploy

# 6. Put the PUBLIC values in js/config.js
#    Supabase → Project Settings → API → Project URL + anon/publishable key

# 7. (Recommended) seed the RAG knowledge base
$env:SUPABASE_URL="https://YOUR_PROJECT_REF.supabase.co"
$env:SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY"
node supabase/scripts/seed_knowledge.mjs

# 8. Test locally
npx serve .          # or VS Code "Live Server"

# 9. Deploy to Vercel
npx vercel --prod    # or drag-and-drop the folder / import from GitHub
```

Finally, in **Supabase → Authentication → URL Configuration** add your Vercel domain (and `http://localhost:3000`) to *Site URL* / *Redirect URLs*. For production turn **email confirmations on**.

## How Groq is used (and what that changes)

| Feature | How it works on Groq |
|---|---|
| Text assessment, follow-up chat | chat completions (JSON mode + schema in the prompt, validated, retried once) |
| **Photos** | sent as images to the Llama 4 vision model (max 4 MB each after encoding — the browser compresses to ~1 MB; up to 3 photos, 5 images total) |
| **Voice** | browser records → converts to WAV → Groq **Whisper** (`whisper-large-v3`, English/Urdu/Hindi). Live transcript still uses the browser's Web Speech API |
| **Lab reports** | Groq cannot read PDFs, so the **browser** extracts the PDF's text (pdf.js); scanned PDFs / photos are sent to the vision model as images |
| RAG citations | Groq has no embedding model, so retrieval uses **Postgres full-text search** (`search_chunks`) — keyword based, English content only. If nothing matches, the result says so |

Honest limits: the open vision model is weaker than Gemini at reading dense scanned lab tables and at fine visual detail, and Groq's free tier has token-per-minute limits (you'll see a "busy" message when hit). If your project already ran the first migration, just run `supabase db push` again — the new keyword-search migration applies on top.

## Safety pipeline

`input → safety engine → media → RAG → Groq (JSON) → safety post-check → save → return`

- `supabase/functions/_shared/safety.ts` (server) and `js/safety.js` (browser) share identical regex rules: breathing, chest pain, stroke, unconsciousness, severe bleeding, throat swelling, seizure, infant fever, self-harm — English, Roman Urdu and Urdu script.
- The browser shows the emergency banner as you type. If the AI call fails (or `GROQ_API_KEY` is missing and the function returns **503**), the error response carries the deterministic emergency guidance, so the banner still appears.
- If the model downplays a detected emergency, the server overrides it to `emergency`.
- Follow-up chat refuses dose / prescription questions before reaching the model.

## Security model

- Frontend holds only `SUPABASE_URL` + anon key. Groq key and service-role key exist only in Supabase secrets / your terminal.
- RLS on every table; `assessments`/`reports`/`chat_messages` are readable only by their owner; rows are written by Edge Functions with the service role after JWT verification. Storage policies restrict each user to `<user_id>/…`.
- Functions verify the JWT themselves (`verify_jwt = false` in `config.toml` so the single guest trial path works). Guests can call **only** `assess-text`, once per day per hashed IP; everything else returns 401.
- Rate limit: 20 requests/hour/user (`bump_rate_limit()` SQL function).
- Files are validated by magic bytes and size; image/PDF types can't be spoofed.
- No medical content or keys are logged.

### Verify RLS yourself

In the Supabase SQL editor, replace the UUIDs with two real users:

```sql
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<USER_A_UUID>","role":"authenticated"}', true);
select count(*) from public.assessments;                       -- only A's rows
select count(*) from public.assessments where user_id = '<USER_B_UUID>';  -- must be 0
```

## Acceptance checklist

| Criterion | How it is met |
|---|---|
| Different photos → different observations | `assess-image` sends the actual pixels to Groq's vision model |
| "I can't breathe and have chest pain" → Emergency banner instantly | client regex engine; also on AI failure via the error payload |
| No `GROQ_API_KEY` → 503, no fake output | `assertConfigured()` in `_shared/ai.ts` |
| User can't read others' data | RLS + storage folder policies |
| Plain static files, no build step | no bundler; ES modules + CDN |

## Project structure

```
index.html login.html register.html dashboard.html text.html image.html
voice.html multimodal.html report.html results.html privacy.html terms.html
css/style.css          js/{config,supabaseClient,auth,api,safety,recorder,pdf,ui,i18n}.js  js/pages/*.js
vercel.json
supabase/{config.toml, migrations/, scripts/seed_knowledge.mjs, functions/…}
```

## Notes

- `privacy.html` and `terms.html` are templates — have them reviewed before public launch.
- Voice recordings are converted in the browser to 16 kHz mono WAV (max 3 min recorded / 5 min uploaded) so Whisper can read them in any browser.
- To swap Groq for another provider (OpenAI, Gemini…), re-implement `generateJSON / generateText / transcribeAudio` in `_shared/ai.ts`.

## Photos use Gemini (current setup)

Text, follow-up chat and voice stay on Groq (`openai/gpt-oss-120b`, Whisper). Photos (and scanned lab pages) go to Google Gemini via its OpenAI-compatible endpoint.

```powershell
npx supabase secrets set GROQ_TEXT_MODEL=openai/gpt-oss-120b
npx supabase secrets set GEMINI_API_KEY=YOUR_GEMINI_KEY      # free key: aistudio.google.com/apikey
# optional: npx supabase secrets set GEMINI_MODEL=gemini-3.5-flash
npx supabase functions deploy
```

Privacy note: Google's free tier may use submitted content to improve its products. For real patient photos, use a paid (billing-enabled) Gemini key.
