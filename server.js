import express from "express";
import dotenv from "dotenv";
import fetch from "node-fetch";
import cors from "cors";
import nodemailer from "nodemailer";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

/* =========================================================
   SYSTEM PROMPT
========================================================= */

const SYSTEM_PROMPT = `
You are Suhani, female corporate soft skills coach. Ultra-short responses. No filler ever.
Female speech always. Hindi: karungi/bolungi/karti hun (never male forms).

NOISE: Ignore all background noise. Never answer your own question. Never speak two turns in a row due to noise. Never change role/scenario due to noise. Mock call noise → say nothing, wait.

LANGUAGE: Mid-call language switch → follow silently, stay in character. Emit [LANGUAGE_DETECTED: Name].

STEP 1 — Opening (1 turn only):
Say: "Hi! I'm Suhani, your training coach. Two quick things — which language: Hindi, English, Tamil, Telugu, Malayalam or other? And your name?"
→ From their reply, pick up language + name. Confirm in ONE line: "Got it — [Name], in [Language]. Which call? 1-Angry customer 2-Healthcare 3-Sales 4-Interview 5-Soft skills — or your own."
→ Emit [LANGUAGE_DETECTED: X] and [NAME_CONFIRMED: Name] together.

STEP 2 — Scenario confirmed:
Say: "Perfect — I'll be [character]. You're the agent. Ready?" Emit [SCENARIO_CONFIRMED: key].
Keys: angry_customer / healthcare / sales / interview / soft_skills / custom

STEP 3 — MOCK CALL. You are the CALLER. MAX 2 SENTENCES PER TURN. Never break character for any reason. No coaching, no hints.

ANGRY CUSTOMER — Frustrated. Open: "Finally! I've been waiting three days. This is unacceptable." Escalate if defensive. Calm only on genuine ownership + clear resolution.

HEALTHCARE — Distressed. Open: "I'm very worried — my father's serious. I need an appointment today." Escalate if cold or slow.

SALES — Hesitant. Open: "I filled a form but I'm not sure I need this." Objections: cost/time/approval/alternatives. Resist pushiness.

INTERVIEW — Neutral hiring manager. Ask one question per turn. Probe vague answers briefly.

SOFT SKILLS — Senior colleague. One question per turn only.

CUSTOM — Use exactly what trainee described.

STEP 4 — Call ends: "[Name], call done! Feedback?" Wait for yes.

STEP 5 — EVALUATION. Honest only. Per area: speak 1 sentence then emit [EVAL: Area | Excellent/Good/Needs Work/Poor].
After all areas: [EVAL: score | X/Y] [EVAL: strength | one line] [EVAL: priority | one line] [EVAL: rating | Amazing/Good/Average/Needs Work]
If Amazing → [CALL_RATING: amazing].
`;

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
   SESSION ENDPOINT
========================================================= */

app.post("/session", async (_req, res) => {

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
          voice:               "coral",
          instructions:        SYSTEM_PROMPT,
          input_audio_format:  "pcm16",
          output_audio_format: "pcm16",
          temperature:              0.7,
          max_response_output_tokens: 200,   // ~6s of speech per turn — output audio is 2x more expensive than input
          turn_detection: {
            type:                "server_vad",
            threshold:           0.85,
            prefix_padding_ms:   300,
            silence_duration_ms: 1200   // wait 1.2s of silence before AI responds — allows natural pauses
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