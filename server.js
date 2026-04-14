import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import cors from "cors";
import nodemailer from "nodemailer";
import multer from "multer";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { tmpdir } from "os";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

/* =========================================================
   SESSIONS STORAGE
========================================================= */

const SESSIONS_FILE = "./sessions.json";
let sessions = [];

if (existsSync(SESSIONS_FILE)) {
  try { sessions = JSON.parse(readFileSync(SESSIONS_FILE, "utf8")); } catch { sessions = []; }
}

function saveSessions() {
  writeFileSync(SESSIONS_FILE, JSON.stringify(sessions, null, 2));
}


/* =========================================================
   LOG SESSION
========================================================= */

app.post("/log-session", async (req, res) => {
  const s = req.body;
  const session = {
    id:              Date.now().toString(),
    timestamp:       new Date().toISOString(),
    name:            s.name            || "Unknown",
    email:           s.email           || "",
    scenario:        s.scenario        || "—",
    language:        s.language        || "—",
    durationSeconds: s.durationSeconds || 0,
    durationDisplay: s.durationDisplay || "—",
    successful:      s.successful      || false,
    tokens:          s.tokens          || { audioIn:0, audioOut:0, textIn:0, textOut:0 },
    costINR:         s.costINR         || 0,
    feedback:        s.feedback        || null,
    emailSent:       false
  };

  sessions.push(session);
  saveSessions();

  // Auto-email (complete sessions with feedback, or incomplete as a notice)
  if (session.email && process.env.SMTP_USER && process.env.SMTP_PASS) {
    try {
      const subject = session.successful
        ? `Training Feedback — ${session.name} — ${new Date(session.timestamp).toLocaleDateString("en-IN")}`
        : `Incomplete Training Session — ${session.name} — ${new Date(session.timestamp).toLocaleDateString("en-IN")}`;
      const html = session.successful && session.feedback
        ? buildEmailHTML(session.feedback)
        : buildIncompleteEmailHTML(session);
      await mailer.sendMail({
        from: process.env.SMTP_FROM || `Suhani Training <${process.env.SMTP_USER}>`,
        to:   session.email,
        subject, html
      });
      session.emailSent = true;
      saveSessions();
    } catch (err) {
      console.error("Session email error:", err.message);
    }
  }

  res.json({ success: true, id: session.id });
});

/* =========================================================
   SYSTEM PROMPT
========================================================= */

const SCENARIO_SCRIPTS = {
  angry_customer: {
    role: "an angry customer",
    open: "Finally! I've been waiting three whole days and nobody has helped me — this is completely unacceptable.",
    notes: "Escalate if the agent is defensive or vague. Only calm down when they take genuine ownership and give a clear resolution."
  },
  healthcare: {
    role: "a worried family member of a patient",
    open: "I'm really worried — my father's condition is serious and I desperately need an appointment today.",
    notes: "Escalate if the agent sounds cold, dismissive, or stalls. Show relief only when handled with warmth and urgency."
  },
  sales: {
    role: "a hesitant, skeptical prospect",
    open: "I did fill a form online but honestly I'm not sure I even need this.",
    notes: "Raise realistic objections: cost, time, need for approval, other options. Resist any pushiness or pressure tactics."
  },
  interview: {
    role: "a calm, professional hiring manager",
    open: "Thanks for joining — let's start. Tell me a bit about yourself and why you're interested in this role.",
    notes: "Ask one focused question per turn. Follow up on vague or incomplete answers. Stay neutral and professional."
  },
  soft_skills: {
    role: "a senior colleague",
    open: "Hey, glad we could catch up. I wanted to get your thoughts on something — how do you usually handle disagreements within your team?",
    notes: "Ask one thoughtful question per turn. Be inquisitive but warm."
  }
};

function buildPrompt(name, language, scenario, customScenario) {
  let roleDesc, opening, notes;
  if (scenario === "custom") {
    roleDesc = "a character described by the trainee";
    opening  = "(start with an appropriate opening based on the custom scenario below)";
    notes    = `Custom scenario: ${customScenario || "a professional caller in a business context"}`;
  } else {
    const s  = SCENARIO_SCRIPTS[scenario] || SCENARIO_SCRIPTS.soft_skills;
    roleDesc = s.role; opening = s.open; notes = s.notes;
  }

  return `You are Suhani — a warm, natural-sounding female corporate soft skills coach.

LANGUAGE: Speak ONLY in ${language} for this entire session. Never switch to any other language. Always use feminine verb forms.

TRAINEE: The trainee's name is ${name}. They are the AGENT. Never use their name for the customer/caller character you play.

RULES:
- Ignore background noise. If you hear only noise or silence, wait — never repeat a question.
- Speak naturally. Vary your sentence openings. Max 2 sentences per turn during the mock call.
- React realistically to what the agent says — make it feel like a real call.

OPENING (one line only):
Greet ${name} warmly in ${language} and check if they're ready. Example: "Hi ${name}! I'll be playing ${roleDesc} — you're the agent, give it your best. Ready?"
Emit these tags immediately: [NAME_CONFIRMED: ${name}] [LANGUAGE_DETECTED: ${language}] [SCENARIO_CONFIRMED: ${scenario}]

MOCK CALL:
Once they say ready, start immediately. You are the CALLER. Stay fully in character — no hints, no coaching, no breaking character for any reason.
Opening line: "${opening}"
${notes}

CALL END:
When the call ends naturally, say warmly in ${language}: "${name}, that was great practice! Tap the feedback button below for your written evaluation."
Emit: [CALL_DONE]
Do NOT give any verbal evaluation. Stop after this one sentence.`;
}

/* =========================================================
   EMAIL — FEEDBACK SENDER
========================================================= */

const mailer = nodemailer.createTransport({
  host:   process.env.SMTP_HOST || "smtp.gmail.com",
  port:   parseInt(process.env.SMTP_PORT || "587"),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

function buildIncompleteEmailHTML(session) {
  const date = new Date(session.timestamp).toLocaleDateString("en-IN", { weekday:"long", year:"numeric", month:"long", day:"numeric" });
  return `<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;background:#f8fafc;padding:28px 20px">
  <div style="text-align:center;margin-bottom:24px">
    <img src="https://raw.githubusercontent.com/inder20216/openmind-assets/main/logo.png" height="36" alt="OpenMind"><br>
    <h2 style="margin:14px 0 4px;color:#0f172a;font-size:20px">Suhani AI — Incomplete Session</h2>
    <p style="margin:0;color:#64748b;font-size:13px">${date}</p>
  </div>
  <div style="background:white;border-radius:12px;padding:20px 22px;margin-bottom:12px;border:1px solid #e2e8f0">
    <p style="margin:0 0 6px"><strong>Trainee:</strong> ${session.name}</p>
    <p style="margin:0 0 6px"><strong>Scenario:</strong> ${session.scenario}</p>
    <p style="margin:0 0 6px"><strong>Language:</strong> ${session.language}</p>
    <p style="margin:0 0 6px"><strong>Duration:</strong> ${session.durationDisplay}</p>
    <p style="margin:0"><strong>Status:</strong> <span style="color:#dc2626;font-weight:700">Session did not complete</span></p>
  </div>
  <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:12px;padding:16px 20px;margin-bottom:20px;">
    <p style="margin:0;color:#92400e;font-size:13px;">This session was disconnected or ended before the mock call was completed. No evaluation is available. Please try again when you're ready.</p>
  </div>
  <p style="text-align:center;color:#cbd5e1;font-size:11px;margin:0">Powered by Suhani AI · OpenMind Training Platform</p>
</div>`;
}

function buildEmailHTML(f) {
  const date    = new Date().toLocaleDateString("en-IN", { weekday:"long", year:"numeric", month:"long", day:"numeric" });
  const evalRows = (f.evals || []).map(e =>
    `<tr><td style="padding:7px 14px;color:#334155;border-bottom:1px solid #f1f5f9">${e.area}</td>
         <td style="padding:7px 14px;font-weight:700;border-bottom:1px solid #f1f5f9;color:${
           e.rating==="Excellent"?"#16a34a":e.rating==="Good"?"#2563eb":e.rating==="Needs Work"?"#ea580c":"#dc2626"
         }">${e.rating}</td></tr>`
  ).join("");

  return `<div style="font-family:Arial,sans-serif;max-width:580px;margin:0 auto;background:#f8fafc;padding:28px 20px">
  <div style="text-align:center;margin-bottom:24px">
    <img src="https://raw.githubusercontent.com/inder20216/openmind-assets/main/logo.png" height="36" alt="OpenMind"><br>
    <h2 style="margin:14px 0 4px;color:#0f172a;font-size:20px">Suhani AI — Training Feedback</h2>
    <p style="margin:0;color:#64748b;font-size:13px">${date}</p>
  </div>

  <div style="background:white;border-radius:12px;padding:20px 22px;margin-bottom:12px;border:1px solid #e2e8f0">
    <p style="margin:0 0 6px"><strong>Trainee:</strong> ${f.name||"—"}</p>
    <p style="margin:0 0 6px"><strong>Scenario:</strong> ${f.scenario||"—"}</p>
    <p style="margin:0"><strong>Overall:</strong> ${f.score||"—"} &nbsp;•&nbsp; <strong style="color:#0f172a">${f.rating||"—"}</strong></p>
  </div>

  <div style="background:white;border-radius:12px;margin-bottom:12px;border:1px solid #e2e8f0;overflow:hidden">
    <div style="padding:14px 22px;border-bottom:1px solid #f1f5f9;font-weight:700;color:#0f172a;font-size:13px;text-transform:uppercase;letter-spacing:0.5px">Evaluation</div>
    <table style="width:100%;border-collapse:collapse;font-size:14px">${evalRows||"<tr><td style='padding:12px 14px;color:#94a3b8'>No evaluation data</td></tr>"}</table>
  </div>

  <div style="background:white;border-radius:12px;padding:20px 22px;margin-bottom:20px;border:1px solid #e2e8f0">
    <p style="margin:0 0 10px"><span style="color:#16a34a;font-weight:700">✅ Strength</span><br>${f.strength||"—"}</p>
    <p style="margin:0"><span style="color:#ea580c;font-weight:700">🎯 Priority to Improve</span><br>${f.priority||"—"}</p>
  </div>

  <p style="text-align:center;color:#cbd5e1;font-size:11px;margin:0">Powered by Suhani AI · OpenMind Training Platform</p>
</div>`;
}

app.post("/send-feedback", async (req, res) => {
  const { userEmail, managerEmail, feedback } = req.body;
  if (!userEmail || !feedback) return res.status(400).json({ error: "Missing data" });

  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
    console.log("Email not configured — feedback logged:\n", JSON.stringify(feedback, null, 2));
    return res.json({ success: true, note: "Email not configured — logged to console" });
  }

  const recipients = [userEmail, managerEmail].filter(Boolean).join(", ");
  try {
    await mailer.sendMail({
      from:    process.env.SMTP_FROM || `Suhani Training <${process.env.SMTP_USER}>`,
      to:      recipients,
      subject: `Training Feedback — ${feedback.name || "Trainee"} — ${new Date().toLocaleDateString("en-IN")}`,
      html:    buildEmailHTML(feedback)
    });
    res.json({ success: true });
  } catch (err) {
    console.error("Email error:", err.message);
    res.status(500).json({ error: "Email send failed" });
  }
});

/* =========================================================
   TEXT FEEDBACK ENDPOINT (no audio — saves output token cost)
========================================================= */

const FEEDBACK_PROMPT = `You are Suhani, a female corporate soft skills coach giving written feedback after a mock call.
Speak directly and warmly to the trainee by name. Be honest and specific.

For each area below, write ONE sentence of feedback then emit the tag on the same line:
- Greeting & Opening [EVAL: Greeting | Excellent/Good/Needs Work/Poor]
- Empathy & Tone [EVAL: Empathy | ...]
- Problem Understanding [EVAL: Problem Understanding | ...]
- Communication Clarity [EVAL: Communication | ...]
- Resolution & Closing [EVAL: Resolution | ...]

Then on new lines:
[EVAL: score | X/10]
[EVAL: strength | one sentence about their biggest strength]
[EVAL: priority | one sentence about the single most important thing to improve]
[EVAL: rating | Amazing/Good/Average/Needs Work]

If rating is Amazing, also add: [CALL_RATING: amazing]

Keep it honest, warm, and concise. No bullet lists — flowing sentences.
Respond in the SAME LANGUAGE as the conversation transcript.`;

app.post("/feedback", async (req, res) => {
  const { transcript, name, scenario } = req.body;
  if (!transcript) return res.status(400).json({ error: "No transcript" });

  try {
    const gptRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method:  "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model:       "gpt-4o-mini",
        temperature: 0.4,
        messages: [
          { role: "system", content: FEEDBACK_PROMPT },
          { role: "user",   content: `Trainee: ${name || "the trainee"}. Scenario: ${scenario || "soft skills"}.\n\nCall transcript:\n${transcript}` }
        ]
      })
    });

    if (!gptRes.ok) {
      const err = await gptRes.text();
      console.error("Feedback GPT error:", err);
      return res.status(500).json({ error: "Feedback generation failed" });
    }

    const data = await gptRes.json();
    res.json({ text: data.choices[0].message.content });
  } catch (err) {
    console.error("Feedback error:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

/* =========================================================
   CALL AUDIT
========================================================= */

const upload = multer({ dest: tmpdir(), limits: { fileSize: 25 * 1024 * 1024 } });

const AUDIT_PROMPT = `You are a call quality auditor for customer service and corporate communications in India.
Analyze the transcript and return ONLY valid JSON in this exact structure (no markdown, no extra text):
{
  "overall_rating": "Excellent|Good|Average|Poor",
  "overall_score": "X/10",
  "call_summary": "2-3 sentence summary of the call",
  "metrics": [
    {"area": "Greeting & Opening",      "score": "X/10", "rating": "Excellent|Good|Average|Poor", "comment": "one concise line"},
    {"area": "Empathy & Tone",          "score": "X/10", "rating": "...", "comment": "..."},
    {"area": "Problem Understanding",   "score": "X/10", "rating": "...", "comment": "..."},
    {"area": "Communication Clarity",   "score": "X/10", "rating": "...", "comment": "..."},
    {"area": "Resolution & Closing",    "score": "X/10", "rating": "...", "comment": "..."}
  ],
  "good_moments": ["specific moment 1", "specific moment 2"],
  "improvement_areas": ["specific area 1", "specific area 2"],
  "top_recommendation": "the single most impactful thing to improve"
}
Be honest and specific. Handle Indian regional languages (Hindi, Tamil, Telugu, Malayalam, Kannada) naturally.`;

// Transcribe — accepts file upload or audio URL
app.post("/audit/transcribe", upload.single("audio"), async (req, res) => {
  let filePath = null;
  let cleanup  = false;
  let fileName = "audio.mp3";

  try {
    if (req.file) {
      // File uploaded via multipart
      filePath = req.file.path;
      fileName = req.file.originalname || "audio.mp3";
      cleanup  = true;
    } else if (req.body && req.body.url) {
      // Download from URL to temp file
      const audioResp = await fetch(req.body.url);
      if (!audioResp.ok) return res.status(400).json({ error: "Could not download audio from URL" });
      const buf = Buffer.from(await audioResp.arrayBuffer());
      filePath = `${tmpdir()}/audit_${Date.now()}.mp3`;
      writeFileSync(filePath, buf);
      cleanup = true;
      fileName = req.body.url.split("/").pop().split("?")[0] || "audio.mp3";
    } else {
      return res.status(400).json({ error: "Provide an audio file or URL" });
    }

    const audioBytes = readFileSync(filePath);
    const form = new FormData();
    form.append("file", new Blob([audioBytes]), fileName);
    form.append("model", "whisper-1");
    form.append("response_format", "verbose_json");
    form.append("timestamp_granularities[]", "segment");

    const whisperResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method:  "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}` },
      body:    form
    });

    if (!whisperResp.ok) {
      const err = await whisperResp.text();
      console.error("Whisper error:", err);
      return res.status(500).json({ error: "Transcription failed" });
    }

    const data = await whisperResp.json();
    res.json({ transcript: data.text, language: data.language, segments: data.segments || [] });

  } catch (err) {
    console.error("Transcribe error:", err);
    res.status(500).json({ error: "Internal error during transcription" });
  } finally {
    if (cleanup && filePath) { try { unlinkSync(filePath); } catch {} }
  }
});

// Evaluate — audit the transcript with GPT
app.post("/audit/evaluate", async (req, res) => {
  const { transcript } = req.body;
  if (!transcript) return res.status(400).json({ error: "No transcript provided" });

  try {
    const gptResp = await fetch("https://api.openai.com/v1/chat/completions", {
      method:  "POST",
      headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model:       "gpt-4o-mini",
        temperature: 0.3,
        messages: [
          { role: "system", content: AUDIT_PROMPT },
          { role: "user",   content: `Transcript:\n\n${transcript}` }
        ]
      })
    });

    if (!gptResp.ok) {
      const err = await gptResp.text();
      console.error("GPT audit error:", err);
      return res.status(500).json({ error: "Evaluation failed" });
    }

    const data    = await gptResp.json();
    const raw     = data.choices[0].message.content.trim();
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const parsed  = JSON.parse(cleaned);
    res.json(parsed);

  } catch (err) {
    console.error("Evaluate error:", err);
    res.status(500).json({ error: "Internal error during evaluation" });
  }
});

/* =========================================================
   SESSION ENDPOINT
========================================================= */

app.post("/session", async (req, res) => {
  const { name = "there", language = "English", scenario = "soft_skills", customScenario = "" } = req.body || {};

  try {

    const response = await fetch(
      "https://api.openai.com/v1/realtime/sessions",
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model:               "gpt-4o-mini-realtime-preview",
          voice:               "shimmer",
          instructions:        buildPrompt(name, language, scenario, customScenario),
          input_audio_format:  "pcm16",
          output_audio_format: "pcm16",
          input_audio_transcription: { model: "whisper-1" },
          temperature:              0.8,     // slightly more natural/varied responses
          max_response_output_tokens: 500,
          turn_detection: {
            type:                "server_vad",
            threshold:           0.65,
            prefix_padding_ms:   500,
            silence_duration_ms: 1600        // balanced — not too slow, not cutting off Hindi speakers
          }
        }),
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      console.error("OpenAI error:", errText);
      return res.status(500).json({ error: "OpenAI session failed" });
    }

    const data = await response.json();
    res.json(data);

  } catch (err) {
    console.error("Server error:", err);
    res.status(500).json({ error: "Internal server error" });
  }

});

/* =========================================================
   START SERVER
========================================================= */

app.listen(PORT, () => {
  console.log(`🚀 Suhani — AI Voice Mentor running on http://localhost:${PORT}`);
});