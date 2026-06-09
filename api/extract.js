/* ============================================================
   /api/extract — Vercel serverless function (Node runtime)
   Reads pasted notes / a document and extracts only what a goals &
   to-do app needs: long-term goals, short-term goals, today's schedule
   items, and ideas worth keeping. Everything else is discarded.

   Uses the Anthropic Messages API with STRUCTURED OUTPUTS
   (output_config.format = json_schema) so the reply is always valid,
   parseable JSON. No SDK / no dependencies — raw fetch.

   Key is read from process.env.ANTHROPIC_API_KEY (set it in Vercel).
   ============================================================ */

const MODEL = "claude-opus-4-8";

const ITEM = (extra) => ({ type: "object", properties: Object.assign({ title: { type: "string" } }, extra), required: ["title"].concat(Object.keys(extra)), additionalProperties: false });

const SCHEMA = {
  type: "object",
  properties: {
    long_term_goals:  { type: "array", items: ITEM({ deadline: { type: "string", description: "ISO 8601 datetime, or empty string if none" } }) },
    short_term_goals: { type: "array", items: ITEM({ deadline: { type: "string", description: "ISO 8601 datetime, or empty string if none" } }) },
    schedule_today:   { type: "array", items: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } },
    ideas:            { type: "array", items: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } },
  },
  required: ["long_term_goals", "short_term_goals", "schedule_today", "ideas"],
  additionalProperties: false,
};

module.exports = async (req, res) => {
  if (req.method !== "POST") { res.status(405).json({ error: "Method not allowed" }); return; }
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) { res.status(503).json({ error: "ANTHROPIC_API_KEY not set on the server." }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  const text = ((body && body.text) || "").toString().slice(0, 24000);
  if (!text.trim()) { res.status(400).json({ error: "No text to extract from." }); return; }

  const now = new Date();
  const system =
    "You extract structured items from a user's pasted notes or documents for a personal goals & to-do app. " +
    "Pull out ONLY: long-term goals, short-term goals, today's schedule items, and ideas/notes worth keeping. " +
    "Discard greetings, filler, duplicated phrasing, and anything a to-do app wouldn't need. " +
    "Classify a goal as long-term if it spans weeks/months or is clearly a big objective; otherwise short-term. " +
    "Put time-specific tasks for today into schedule_today. Put loose thoughts, reminders, and brainstorming into ideas. " +
    "If an item mentions a deadline or date, convert it to an ISO 8601 datetime (e.g. 2026-06-13T17:00:00); otherwise use an empty string. " +
    "Use the current datetime " + now.toISOString() + " to resolve relative dates like 'Friday' or 'next week'. " +
    "Keep titles concise. Do NOT invent items that aren't in the text. If a category has nothing, return an empty array.";

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2500,
        system: system,
        messages: [{ role: "user", content: text }],
        output_config: { format: { type: "json_schema", schema: SCHEMA } },
      }),
    });
    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      res.status(502).json({ error: "Anthropic API error " + r.status, detail: detail.slice(0, 500) });
      return;
    }
    const data = await r.json();
    const jsonText = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("");
    let extracted;
    try { extracted = JSON.parse(jsonText); } catch (e) { res.status(502).json({ error: "Model returned unparseable output." }); return; }
    res.status(200).json({ extracted });
  } catch (e) {
    res.status(500).json({ error: "Request failed", detail: String(e && e.message || e) });
  }
};
