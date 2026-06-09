/* ============================================================
   Goals & Daily Schedule — app logic
   - Store: Supabase (when reachable) with localStorage fallback,
     so the app works instantly and syncs when the tables exist.
   - Live deadline countdowns + the filling timer line.
   - Brain-dump ideas with "surprise me" resurfacing.

   Tables expected (see supabase-setup.sql):
     goals(id uuid, type text, title text, created_at, deadline, done)
     schedule_items(id uuid, day date, text text, done, from_goal_id, created_at)
     ideas(id uuid, text text, created_at)
   The anon key below is the public/publishable key — safe in client code;
   data access is governed by Row-Level Security in Supabase.
   ============================================================ */

const SUPABASE_URL = "https://xwflimbghmdlmhuuabnc.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3ZmxpbWJnaG1kbG1odXVhYm5jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwMDkxODksImV4cCI6MjA5NjU4NTE4OX0.jzrFGazXFsTE3qKK27oICEDhNH8Fqo4nkYnf5BolY-c";

/* ---------- tiny helpers ---------- */
const $ = (id) => document.getElementById(id);
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Date.now() + "-" + Math.random().toString(16).slice(2));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const HOUR = 3600e3, DAY = 86400e3, MIN = 60e3;
const todayKey = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };

/* ---------- state ---------- */
const state = { goals: [], schedule: [], ideas: [] };
let supa = null;            // supabase client (set async)
let remoteOK = false;       // tables reachable?

/* ---------- localStorage (instant) ---------- */
const LS = { goals: "gs.goals", schedule: "gs.schedule", ideas: "gs.ideas" };
function loadLocal() {
  try {
    state.goals = JSON.parse(localStorage.getItem(LS.goals) || "[]");
    state.schedule = JSON.parse(localStorage.getItem(LS.schedule) || "[]");
    state.ideas = JSON.parse(localStorage.getItem(LS.ideas) || "[]");
  } catch (e) { /* corrupt store — start clean */ }
}
function saveLocal() {
  localStorage.setItem(LS.goals, JSON.stringify(state.goals));
  localStorage.setItem(LS.schedule, JSON.stringify(state.schedule));
  localStorage.setItem(LS.ideas, JSON.stringify(state.ideas));
}

/* ---------- Supabase sync (best-effort) ---------- */
async function initSupabase() {
  try {
    const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
    supa = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    await pullAll();
  } catch (e) {
    console.warn("[goals] Supabase unavailable — running on local storage only.", e);
  }
}
async function pullAll() {
  if (!supa) return;
  try {
    const [g, s, i] = await Promise.all([
      supa.from("goals").select("*"),
      supa.from("schedule_items").select("*"),
      supa.from("ideas").select("*"),
    ]);
    if (g.error || s.error || i.error) {
      const err = g.error || s.error || i.error;
      console.warn("[goals] Could not read Supabase tables yet — using local data. Run supabase-setup.sql in the SQL editor.", err.message);
      remoteOK = false;
      return;
    }
    remoteOK = true;
    state.goals = (g.data || []).map(rowToGoal);
    state.schedule = (s.data || []).map(rowToSched);
    state.ideas = (i.data || []).map(rowToIdea);
    saveLocal();
    renderAll();
  } catch (e) {
    console.warn("[goals] Supabase read failed — using local data.", e);
  }
}
function push(table, row) { if (supa && remoteOK) supa.from(table).upsert(row).then(({ error }) => { if (error) console.warn("[goals] sync upsert failed", error.message); }); }
function removeRemote(table, id) { if (supa && remoteOK) supa.from(table).delete().eq("id", id).then(({ error }) => { if (error) console.warn("[goals] sync delete failed", error.message); }); }

/* row<->model mapping (snake_case in DB) */
const goalToRow = (g) => ({ id: g.id, type: g.type, title: g.title, created_at: g.createdAt, deadline: g.deadline, done: g.done });
const rowToGoal = (r) => ({ id: r.id, type: r.type, title: r.title, createdAt: r.created_at, deadline: r.deadline, done: r.done });
const schedToRow = (s) => ({ id: s.id, day: s.day, text: s.text, done: s.done, from_goal_id: s.fromGoalId || null, created_at: s.createdAt });
const rowToSched = (r) => ({ id: r.id, day: r.day, text: r.text, done: r.done, fromGoalId: r.from_goal_id, createdAt: r.created_at });
const ideaToRow = (i) => ({ id: i.id, text: i.text, created_at: i.createdAt });
const rowToIdea = (r) => ({ id: r.id, text: r.text, createdAt: r.created_at });

/* ---------- mutations ---------- */
function addGoal(type, title, deadline) {
  const g = { id: uid(), type, title: title.trim(), createdAt: new Date().toISOString(), deadline: deadline || null, done: false };
  state.goals.push(g); saveLocal(); push("goals", goalToRow(g)); renderAll();
}
function toggleGoal(id) {
  const g = state.goals.find((x) => x.id === id); if (!g) return;
  g.done = !g.done; saveLocal(); push("goals", goalToRow(g)); renderAll();
}
function deleteGoal(id) {
  state.goals = state.goals.filter((x) => x.id !== id); saveLocal(); removeRemote("goals", id); renderAll();
}
function addToToday(goalId) {
  const g = state.goals.find((x) => x.id === goalId); if (!g) return;
  const it = { id: uid(), day: todayKey(), text: g.title, done: false, fromGoalId: g.id, createdAt: new Date().toISOString() };
  state.schedule.push(it); saveLocal(); push("schedule_items", schedToRow(it)); renderAll();
  selectTab("daily");
}
function addDaily(text) {
  const it = { id: uid(), day: todayKey(), text: text.trim(), done: false, fromGoalId: null, createdAt: new Date().toISOString() };
  state.schedule.push(it); saveLocal(); push("schedule_items", schedToRow(it)); renderAll();
}
function toggleDaily(id) {
  const it = state.schedule.find((x) => x.id === id); if (!it) return;
  it.done = !it.done; saveLocal(); push("schedule_items", schedToRow(it)); renderAll();
}
function deleteDaily(id) {
  state.schedule = state.schedule.filter((x) => x.id !== id); saveLocal(); removeRemote("schedule_items", id); renderAll();
}
function addIdea(text) {
  const it = { id: uid(), text: text.trim(), createdAt: new Date().toISOString() };
  state.ideas.unshift(it); saveLocal(); push("ideas", ideaToRow(it)); renderAll();
}
function deleteIdea(id) {
  state.ideas = state.ideas.filter((x) => x.id !== id); saveLocal(); removeRemote("ideas", id); renderAll();
}

/* ---------- time formatting ---------- */
function fmtLeft(ms) {
  if (ms <= 0) return "overdue";
  if (ms < HOUR) return Math.max(1, Math.round(ms / MIN)) + "m left";
  if (ms < DAY) return Math.round(ms / HOUR) + "h left";
  return Math.round(ms / DAY) + "d left";
}
function fmtCountdown(ms) {
  if (ms <= 0) return "overdue";
  const d = Math.floor(ms / DAY), h = Math.floor((ms % DAY) / HOUR), m = Math.floor((ms % HOUR) / MIN), s = Math.floor((ms % MIN) / 1000);
  if (d > 0) return d + "d " + h + "h " + m + "m";
  if (h > 0) return h + "h " + m + "m";
  return m + "m " + s + "s";
}
function fmtWhen(iso) { return new Date(iso).toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
/* warning lead time scales with the goal's length: ~1h for short goals up to ~1 day for long ones */
function leadFor(g) {
  const span = g.deadline && g.createdAt ? new Date(g.deadline) - new Date(g.createdAt) : 0;
  return Math.min(DAY, Math.max(HOUR, span * 0.1));
}
function urgency(g) {
  if (!g.deadline || g.done) return null;
  const left = new Date(g.deadline) - Date.now();
  if (left <= 0) return "red";
  if (left <= leadFor(g)) return "red";
  if (left <= leadFor(g) * 3) return "amber";
  return "accent";
}

/* ---------- timer line sizing (positional gradient) ---------- */
function sizeTimers() {
  document.querySelectorAll(".timer__track").forEach((tr) => {
    const fill = tr.querySelector(".timer__fill");
    if (fill) fill.style.setProperty("--timer-w", tr.clientWidth + "px");
  });
}
function progressOf(g) {
  if (!g.deadline) return 0;
  const start = new Date(g.createdAt).getTime(), end = new Date(g.deadline).getTime(), now = Date.now();
  if (end <= start) return 1;
  return Math.max(0, Math.min(1, (now - start) / (end - start)));
}

/* ---------- rendering ---------- */
function renderAll() { renderGoals("long"); renderGoals("short"); renderDaily(); renderIdeas(); renderHero(); updateCounts(); sizeTimers(); }

function goalItemHTML(g) {
  const u = urgency(g);
  const badge = !g.deadline ? '<span class="badge badge--neutral">no deadline</span>'
    : '<span class="badge badge--' + u + '">' + esc(fmtLeft(new Date(g.deadline) - Date.now())) + "</span>";
  const timer = g.deadline ? '<div class="timer"><div class="timer__track"><div class="timer__fill" style="width:' + (progressOf(g) * 100).toFixed(1) + '%"></div></div><div class="timer__labels"><span>' + esc(fmtWhen(g.createdAt)) + '</span><span>' + esc(fmtWhen(g.deadline)) + "</span></div></div>" : "";
  const toToday = g.type === "short" && !g.done ? '<button class="iconbtn" title="Add to today" data-act="totoday" data-id="' + g.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg></button>' : "";
  return '<li class="item">' +
    '<div class="item__top">' +
      '<div class="item__title ' + (g.done ? "is-done" : "") + '">' + esc(g.title) + "</div>" +
      '<div class="item__actions">' + badge +
        '<button class="iconbtn" title="Mark done" data-act="done" data-id="' + g.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></button>' +
        toToday +
        '<button class="iconbtn iconbtn--danger" title="Delete" data-act="del" data-id="' + g.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m2 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/></svg></button>' +
      "</div>" +
    "</div>" + timer + "</li>";
}

function renderGoals(type) {
  const list = $(type + "-list"), empty = $(type + "-empty");
  const items = state.goals.filter((g) => g.type === type)
    .sort((a, b) => (a.done - b.done) || ((a.deadline ? new Date(a.deadline) : Infinity) - (b.deadline ? new Date(b.deadline) : Infinity)));
  list.innerHTML = items.map(goalItemHTML).join("");
  empty.style.display = items.length ? "none" : "";
  list.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => {
    const id = b.dataset.id;
    if (b.dataset.act === "done") toggleGoal(id);
    else if (b.dataset.act === "del") deleteGoal(id);
    else if (b.dataset.act === "totoday") addToToday(id);
  }));
}

function renderDaily() {
  const list = $("daily-list"), empty = $("daily-empty");
  $("daily-date").textContent = new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
  const items = state.schedule.filter((s) => s.day === todayKey()).sort((a, b) => (a.done - b.done) || new Date(a.createdAt) - new Date(b.createdAt));
  list.innerHTML = items.map((it) =>
    '<li class="row">' +
      '<input class="check" type="checkbox" ' + (it.done ? "checked" : "") + ' data-act="dcheck" data-id="' + it.id + '" aria-label="Done" />' +
      '<span class="row__text ' + (it.done ? "is-done" : "") + '">' + esc(it.text) + (it.fromGoalId ? ' <span class="badge badge--accent">goal</span>' : "") + "</span>" +
      '<button class="iconbtn iconbtn--danger" title="Remove" data-act="ddel" data-id="' + it.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
    "</li>").join("");
  empty.style.display = items.length ? "none" : "";
  list.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.act === "dcheck") toggleDaily(b.dataset.id);
    else if (b.dataset.act === "ddel") deleteDaily(b.dataset.id);
  }));
}

let spotlightId = null;
function renderIdeas() {
  const list = $("ideas-list"), empty = $("ideas-empty");
  const items = state.ideas.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  list.innerHTML = items.map((it) =>
    '<li class="idea ' + (it.id === spotlightId ? "idea--spotlight" : "") + '">' +
      "<div><div class=\"idea__text\">" + esc(it.text) + "</div>" +
      '<div class="idea__time">' + esc(fmtWhen(it.createdAt)) + "</div></div>" +
      '<button class="iconbtn iconbtn--danger" title="Delete" data-act="idel" data-id="' + it.id + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>' +
    "</li>").join("");
  empty.style.display = items.length ? "none" : "";
  list.querySelectorAll("[data-act='idel']").forEach((b) => b.addEventListener("click", () => deleteIdea(b.dataset.id)));
}

function renderHero() {
  const hero = $("hero"), body = $("hero-body"), emptyEl = $("hero-empty");
  const upcoming = state.goals
    .filter((g) => g.deadline && !g.done)
    .sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  const g = upcoming[0];
  if (!g) { body.hidden = true; emptyEl.hidden = false; hero.classList.remove("is-danger"); return; }
  emptyEl.hidden = true; body.hidden = false;
  const left = new Date(g.deadline) - Date.now();
  $("hero-title").textContent = g.title;
  $("hero-due").textContent = (g.type === "long" ? "Long-term" : "Short-term") + " · due " + fmtWhen(g.deadline);
  $("hero-countdown").textContent = left <= 0 ? "overdue" : fmtCountdown(left) + " left";
  $("hero-fill").style.width = (progressOf(g) * 100).toFixed(1) + "%";
  $("hero-start").textContent = fmtWhen(g.createdAt);
  $("hero-end").textContent = fmtWhen(g.deadline);
  hero.classList.toggle("is-danger", urgency(g) === "red");
}

function updateCounts() {
  $("count-long").textContent = state.goals.filter((g) => g.type === "long" && !g.done).length;
  $("count-short").textContent = state.goals.filter((g) => g.type === "short" && !g.done).length;
  $("count-daily").textContent = state.schedule.filter((s) => s.day === todayKey() && !s.done).length;
}

/* ---------- tabs ---------- */
const tabs = Array.from(document.querySelectorAll(".tab"));
const panels = Array.from(document.querySelectorAll(".panel"));
function selectTab(name) {
  tabs.forEach((t) => { const on = t.dataset.tab === name; t.classList.toggle("is-active", on); t.setAttribute("aria-selected", on ? "true" : "false"); });
  panels.forEach((p) => { const on = p.dataset.panel === name; p.classList.toggle("is-active", on); p.hidden = !on; });
  sizeTimers();
}
tabs.forEach((t) => t.addEventListener("click", () => selectTab(t.dataset.tab)));

/* ---------- forms ---------- */
$("form-long").addEventListener("submit", (e) => { e.preventDefault(); const t = $("long-title"); if (!t.value.trim()) return; addGoal("long", t.value, $("long-deadline").value ? new Date($("long-deadline").value).toISOString() : null); t.value = ""; $("long-deadline").value = ""; });
$("form-short").addEventListener("submit", (e) => { e.preventDefault(); const t = $("short-title"); if (!t.value.trim()) return; addGoal("short", t.value, $("short-deadline").value ? new Date($("short-deadline").value).toISOString() : null); t.value = ""; $("short-deadline").value = ""; });
$("form-daily").addEventListener("submit", (e) => { e.preventDefault(); const t = $("daily-text"); if (!t.value.trim()) return; addDaily(t.value); t.value = ""; });
$("form-idea").addEventListener("submit", (e) => { e.preventDefault(); const t = $("idea-text"); if (!t.value.trim()) return; addIdea(t.value); t.value = ""; });
$("surprise").addEventListener("click", () => {
  if (!state.ideas.length) return;
  spotlightId = state.ideas[Math.floor(Math.random() * state.ideas.length)].id;
  renderIdeas();
  const el = document.querySelector(".idea--spotlight");
  if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
});

/* ============================================================
   AI GREETER + CHAT
   UI is fully built; the "brain" is a local placeholder (localBrain)
   that already reads your real goals/ideas. To switch to real Claude
   later, replace localBrain() with a call to a Vercel serverless
   function (/api/chat) that holds your ANTHROPIC_API_KEY server-side.
   ============================================================ */
const USER_NAME = "Luke";
function greetingWord() { const h = new Date().getHours(); return h < 5 ? "Up late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; }
function setGreeting() { const el = $("greet"); if (el) el.textContent = greetingWord() + ", " + USER_NAME; }

const chatEl = $("chat"), greeterEl = $("greeter"), logEl = $("chat-log"), chipsEl = $("chat-chips");
let chatStarted = false;
const CHIPS = ["What's my nearest goal?", "How can I hit it?", "Summarize my day", "Read me an idea"];

function bubble(role, html) {
  const b = document.createElement("div");
  b.className = "bubble bubble--" + (role === "you" ? "you" : "ai");
  b.innerHTML = html;
  logEl.appendChild(b);
  logEl.scrollTop = logEl.scrollHeight;
  return b;
}
function renderChips() {
  chipsEl.innerHTML = "";
  CHIPS.forEach((c) => { const b = document.createElement("button"); b.type = "button"; b.className = "chip"; b.textContent = c; b.addEventListener("click", () => sendMessage(c)); chipsEl.appendChild(b); });
}

/* local placeholder brain — reads the same state the app uses */
function localBrain(text) {
  const t = text.toLowerCase();
  const open = state.goals.filter((g) => !g.done);
  const dated = open.filter((g) => g.deadline).sort((a, b) => new Date(a.deadline) - new Date(b.deadline));
  const nearest = dated[0];
  const todays = state.schedule.filter((s) => s.day === todayKey());

  if (/idea|jot|remember|note/.test(t)) {
    if (!state.ideas.length) return "Your brain-dump is empty — jot a thought in the Ideas box and I'll keep it for you.";
    const pick = state.ideas[Math.floor(Math.random() * state.ideas.length)];
    return "Here's one from <strong>" + esc(fmtWhen(pick.createdAt)) + "</strong>:<br>“" + esc(pick.text) + "”";
  }
  if (/today|schedule|day/.test(t)) {
    if (!todays.length) return "Nothing on today's schedule yet. Add a few things — or pull one from your short-term goals.";
    const done = todays.filter((s) => s.done).length;
    return "Today you've got <strong>" + todays.length + "</strong> item" + (todays.length > 1 ? "s" : "") + " (" + done + " done):<br>• " + todays.map((s) => esc(s.text)).join("<br>• ");
  }
  if (/nearest|next|coming|soon|deadline|due/.test(t)) {
    if (!nearest) return "You don't have any goals with a deadline yet. Add one and I'll start the countdown.";
    const left = new Date(nearest.deadline) - Date.now();
    return "Your nearest goal is <strong>" + esc(nearest.title) + "</strong> — due " + esc(fmtWhen(nearest.deadline)) + " (" + esc(left <= 0 ? "overdue" : fmtCountdown(left) + " left") + ").";
  }
  if (/hit|achieve|how|plan|tips|reach|finish|done/.test(t)) {
    if (!nearest && !open.length) return "Add a goal first and I'll help you break it down into a plan.";
    const g = nearest || open[0];
    const left = g.deadline ? new Date(g.deadline) - Date.now() : null;
    return "To hit <strong>" + esc(g.title) + "</strong>" + (left != null ? " (" + esc(left <= 0 ? "overdue" : fmtCountdown(left) + " left") + ")" : "") + ", try this:<br>" +
      "1. Break it into 2–3 concrete next steps.<br>" +
      "2. Drop the first step into <strong>today's schedule</strong> so it's scheduled, not just hoped for.<br>" +
      "3. Protect a focused block today and knock out step one.<br><br>Want me to add the first step to today?";
  }
  // default
  const bits = [];
  if (nearest) bits.push("your nearest goal is <strong>" + esc(nearest.title) + "</strong>");
  if (todays.length) bits.push(todays.length + " thing" + (todays.length > 1 ? "s" : "") + " on today's list");
  return "Hi " + USER_NAME + "! Ask me about your goals, your day, or your ideas." + (bits.length ? "<br>Right now, " + bits.join(" and ") + "." : "");
  // NOTE: swap this whole function for: const r = await fetch('/api/chat', {...}); return r.text();
}

/* Ask the real Claude brain via /api/chat; fall back to localBrain on any failure
   (no key set, offline, etc.) so the chat always responds. */
async function getReply(text) {
  try {
    const r = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: text, goals: state.goals, schedule: state.schedule, ideas: state.ideas }),
    });
    if (!r.ok) throw new Error("status " + r.status);
    const data = await r.json();
    if (!data.reply) throw new Error("no reply");
    return esc(data.reply).replace(/\n/g, "<br>");  // Claude returns plain text
  } catch (e) {
    return localBrain(text);                          // localBrain already returns safe HTML
  }
}

function sendMessage(text) {
  if (!text || !text.trim()) return;
  bubble("you", esc(text));
  greeterEl.classList.add("is-thinking");
  const typing = bubble("ai", '<span class="typing"><span></span><span></span><span></span></span>');
  getReply(text).then((html) => {
    typing.innerHTML = html;
    greeterEl.classList.remove("is-thinking");
    logEl.scrollTop = logEl.scrollHeight;
  });
}

function openChat() {
  chatEl.hidden = false;
  greeterEl.setAttribute("aria-expanded", "true");
  if (!chatStarted) {
    chatStarted = true;
    renderChips();
    setTimeout(() => bubble("ai", localBrain("")), 220);
  }
  $("chat-input").focus();
}
function toggleChat() { if (chatEl.hidden) openChat(); else { chatEl.hidden = true; greeterEl.setAttribute("aria-expanded", "false"); } }

greeterEl.addEventListener("click", toggleChat);
$("chat-form").addEventListener("submit", (e) => { e.preventDefault(); const i = $("chat-input"); const v = i.value; i.value = ""; sendMessage(v); });

/* ---------- live clock + ticking countdowns ---------- */
const clockEl = $("clock"), tzEl = $("tz");
const tzName = Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
if (tzEl) tzEl.textContent = tzName.replace(/_/g, " ");
function tick() {
  const now = new Date();
  clockEl.firstChild.nodeValue = now.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }) + "  ·  " + now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + "  ";
  setGreeting();
  renderHero();              // keeps the hero countdown + danger flash live
}

/* ---------- boot ---------- */
window.addEventListener("resize", sizeTimers);
loadLocal();
renderAll();
tick();
setInterval(tick, 1000);
initSupabase();              // async: pulls + enables sync when tables exist
