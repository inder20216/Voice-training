# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the project

```bash
npm install        # install dependencies
node server.js     # start on http://localhost:3000
```

There are no tests or lint scripts. The only entry point is `server.js`.

## Pages

| URL | File | Purpose |
|---|---|---|
| `/` | `public/index.html` | Main training session |
| `/audit.html` | `public/audit.html` | Standalone call audit (upload recording) |

## Environment variables (`.env`)

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Required — used for Realtime sessions, Whisper, GPT-4o-mini |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | Optional — if absent, feedback emails are logged to console instead of sent |

## Architecture

This is a single-file Express backend (`server.js`) + two static HTML pages (`public/`). No build step, no framework, no database.

### `server.js` — all backend logic

ES modules (`"type": "module"` in package.json). Key sections in order:

1. **`buildPrompt(name, language, scenario, customScenario)`** — builds the per-session system prompt dynamically from form data. The voice AI receives the trainee's name, chosen language, and scenario already baked in — it skips all setup questions and opens the mock call directly. `SCENARIO_SCRIPTS` holds the role, opening line, and behaviour notes for each scenario type.

2. **`POST /session`** — creates an OpenAI Realtime ephemeral session and returns the client secret to the browser. The browser then connects directly to OpenAI via WebRTC using that secret. Server never touches audio. Key config: model `gpt-4o-mini-realtime-preview`, voice `shimmer`, VAD threshold `0.65`, silence `1600ms`.

3. **`POST /feedback`** — called after the voice session ends. Takes the accumulated call transcript and returns a structured text evaluation from `gpt-4o-mini` (chat completions, not realtime — no audio cost). Parses `[EVAL: Area | Rating]` machine tags that the frontend reads to populate the evaluation cards.

4. **`POST /log-session`** — called automatically from the frontend when any session ends (success or failure). Writes to `sessions.json`. If SMTP is configured, auto-emails the trainee: full feedback HTML for complete sessions, an incomplete-notice email otherwise. Fields stored: name, email, scenario, language, duration, successful flag, token breakdown, cost in INR, feedback object.

5. **`POST /admin/login`** / **`GET /admin/sessions`** / **`DELETE /admin/sessions/:id`** — admin API. Password checked against `ADMIN_PASS` env var via `Authorization: Bearer` header. Sessions served newest-first.

6. **`POST /send-feedback`** — sends the evaluation as an HTML email via nodemailer to trainee + manager. Gracefully skips if SMTP not configured.

5. **`POST /audit/transcribe`** — accepts a multipart file upload or JSON `{ url }`. Downloads/receives audio, sends to Whisper (`whisper-1`), returns transcript with segments and detected language. Temp files are cleaned up in `finally`.

6. **`POST /audit/evaluate`** — takes a plain transcript string, sends to `gpt-4o-mini`, returns structured JSON audit (scores, good moments, improvement areas).

### `public/index.html` — main training page

All JS is inline. Key runtime concepts:

- **Pre-session form**: User fills name, email, language, scenario before anything starts. The form data is posted to `/session` which builds a dynamic prompt — Suhani already knows everything and opens the mock call directly after a one-line greeting.
- **WebRTC flow**: `POST /session` → get ephemeral key → `RTCPeerConnection` → data channel `oai-events` → SDP exchange directly with `api.openai.com/v1/realtime`. The server only brokers the key.
- **Machine tags**: The voice AI emits `[TAG: value]` strings inside its audio transcript. The frontend parses these from `response.audio_transcript.done` events on the data channel to drive UI state (step progress, name/language display, `[CALL_DONE]` to show the feedback button).
- **Transcript accumulation**: Both Suhani's turns (`response.audio_transcript.done`) and the agent's turns (`conversation.item.input_audio_transcription.completed`) are appended to `callTranscript[]` and sent to `/feedback` when the user clicks "Get My Feedback".
- **Jarvis canvas**: `requestAnimationFrame` loop drawing on a `<canvas>` inside a dark circular container. `vizState` (`idle` / `user_speaking` / `ai_speaking`) drives colours and animation speed. Mic audio goes through `micAnalyser`; AI audio through `aiAnalyser` (both `AnalyserNode`).
- **5-minute hard cutoff**: `setInterval` in `startSessionTimer()` calls `endSession()` at 300 seconds.

### `public/audit.html` — standalone call audit page

No dependency on the training session. User uploads an audio file (≤25 MB) or pastes a direct URL. Two-step: transcribe via `/audit/transcribe`, then evaluate via `/audit/evaluate`. Renders results as metric bars + good/improvement cards.

## AI tag protocol

The voice AI and feedback endpoint both emit machine-readable tags that the frontend parses:

| Tag | Emitted by | Effect |
|---|---|---|
| `[LANGUAGE_DETECTED: X]` | Voice AI | Marks language step done |
| `[NAME_CONFIRMED: Name]` | Voice AI | Sets trainee name in UI |
| `[SCENARIO_CONFIRMED: key]` | Voice AI | Sets scenario, marks step done |
| `[CALL_DONE]` | Voice AI | Shows "Get My Feedback" button |
| `[EVAL: Area \| Rating]` | Text feedback | Populates evaluation cards |
| `[EVAL: score \| X/10]` | Text feedback | Sets overall score |
| `[EVAL: strength \| ...]` | Text feedback | Sets strength summary |
| `[EVAL: priority \| ...]` | Text feedback | Sets priority summary |
| `[EVAL: rating \| ...]` | Text feedback | Sets badge; triggers email send |
| `[CALL_RATING: amazing]` | Text feedback | Triggers "amazing call" UI state |

## Cost model

| Operation | Model | Cost driver |
|---|---|---|
| Voice session (mock call) | `gpt-4o-mini-realtime-preview` | Audio in + audio out tokens |
| Text feedback | `gpt-4o-mini` (chat) | Text tokens only — ~10× cheaper than realtime audio |
| Audit transcription | `whisper-1` | Per audio minute |
| Audit evaluation | `gpt-4o-mini` (chat) | Text tokens |

The feedback was deliberately split out of the voice session to avoid paying audio output rates for the evaluation (the longest AI turn).
