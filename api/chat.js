/* ============================================================
   /api/chat — Vercel serverless function (Node runtime)
   Calls the Anthropic Messages API and returns a short coach reply.

   - No SDK / no dependencies: raw fetch to https://api.anthropic.com.
   - The API key is read from process.env.ANTHROPIC_API_KEY and never
     leaves the server. Add it in Vercel → Project → Settings →
     Environment Variables, then redeploy.
   - The browser POSTs { message, goals, schedule, ideas }; we build a
     system prompt from that data so Claude can answer about the user's
     real goals. If the key is missing or the call fails, we return an
     error and the client falls back to its built-in local responder.

   Model: claude-opus-4-8 (most capable). To cut cost/latency, change
   MODEL to "claude-haiku-4-5".
   ============================================================ */

const MODEL = "claude-opus-4-8";
const USER_NAME = "Luke";

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { res.status(503).json({ error: "ANTHROPIC_API_KEY not set on the server." }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};

  const message = (body.message || "").toString().slice(0, 2000);
  if (!message.trim()) { res.status(400).json({ error: "Empty message." }); return; }

  const goals = Array.isArray(body.goals) ? body.goals : [];
  const schedule = Array.isArray(body.schedule) ? body.schedule : [];
  const ideas = Array.isArray(body.ideas) ? body.ideas : [];

  // ---- build a compact snapshot of the user's data for the model ----
  const now = new Date();
  const fmt = (iso) => { try { return new Date(iso).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); } catch (e) { return iso; } };
  const day = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");

  const goalLines = goals.filter((g) => !g.done).map((g) =>
    "- [" + (g.type === "long" ? "long-term" : "short-term") + "] " + g.title +
    (g.deadline ? " (due " + fmt(g.deadline) + ")" : " (no deadline)")
  ).join("\n") || "(none)";
  const todayLines = schedule.filter((s) => s.day === day).map((s) => "- " + s.text + (s.done ? " ✓" : "")).join("\n") || "(nothing scheduled)";
  const ideaLines = ideas.slice(0, 12).map((i) => "- " + i.text).join("\n") || "(none)";

  const system =
    "You are a warm, sharp goals coach living inside " + USER_NAME + "'s personal goals dashboard. " +
    "Answer using their real data below. Be specific and genuinely useful — reference their actual goals, " +
    "deadlines, and schedule by name. Keep replies short: 2–5 sentences or a tight numbered list. " +
    "Respond with your final answer only — no preamble, no meta-commentary about your process. " +
    "The current time is " + now.toLocaleString("en-US") + ".\n\n" +
    "OPEN GOALS:\n" + goalLines + "\n\nTODAY'S SCHEDULE:\n" + todayLines + "\n\nBRAIN-DUMP IDEAS:\n" + ideaLines;

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 800,
        system: system,
        messages: [{ role: "user", content: message }],
      }),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      res.status(502).json({ error: "Anthropic API error " + r.status, detail: detail.slice(0, 500) });
      return;
    }

    const data = await r.json();
    const reply = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
    res.status(200).json({ reply: reply || "(no response)" });
  } catch (e) {
    res.status(500).json({ error: "Request failed", detail: String(e && e.message || e) });
  }
};
