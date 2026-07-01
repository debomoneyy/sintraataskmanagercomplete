import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  "https://dssqafvmryvjsuhhfuxz.supabase.co",
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRzc3FhZnZtcnl2anN1aGhmdXh6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NjQxOTIsImV4cCI6MjA5ODM0MDE5Mn0.JxyYAw3f96U6zWhZYnH2OshqbS6x9lg9itSrgty79Jw"
);

type Cat = "music" | "content" | "admin";
type Owner = "all" | "dela" | "muyii" | "tycoon";
type ArtistKey = "dela" | "muyii" | "tycoon";
type UserKey = ArtistKey | "manager";
interface Task {
  id: string; label: string; cat: Cat; owner: Owner;
  note?: string;
  reactions?: Partial<Record<ArtistKey, string>>; // emoji per artist
}
interface Day  { id: string; day: string; date?: string; tasks: Task[]; } // date = ISO yyyy-mm-dd
interface Month { id: string; title: string; days: Day[]; }
type Schedule = Month[];
type Checks = Record<string, Partial<Record<ArtistKey, boolean>>>;
type Pins = Record<string, string>;
interface AuditEntry { id: string; ts: string; actor: string; action: string; detail: string; }
type AuditLog = AuditEntry[];

const ARTIST_KEYS: ArtistKey[] = ["dela", "muyii", "tycoon"];
const USERS: Record<UserKey, { label: string }> = {
  dela: { label: "Dela" }, muyii: { label: "Muyii" },
  tycoon: { label: "TYCOON" }, manager: { label: "Manager" },
};
const DEFAULT_PINS: Pins = { dela: "1111", muyii: "2222", tycoon: "3333", manager: "0000" };
const CAT_LABEL: Record<Cat, string> = { music: "Music", content: "Content", admin: "Admin" };
const CAT_DOT: Record<Cat, string> = { music: "bg-[#7E8AAD]", content: "bg-[#B8C0D4]", admin: "bg-[#B0453E]" };

// Per-artist identity colors
const ARTIST_COLOR: Record<ArtistKey, string> = {
  dela: "#B0453E",    // rust/red
  muyii: "#5E8FBF",   // blue
  tycoon: "#7E8AAD",  // periwinkle
};
const ARTIST_COLOR_DIM: Record<ArtistKey, string> = {
  dela: "#B0453E30",
  muyii: "#5E8FBF30",
  tycoon: "#7E8AAD30",
};
const REACTION_EMOJIS = ["🔥", "👏", "✅"];

const NAVY_DEEP  = "#060D1C";
const NAVY_MID   = "#0B1830";
const CREAM      = "#F7F5F1";
const CREAM_DIM  = "#ECE9E2";
const BLUE_SOFT  = "#B8C0D4";
const PERIWINKLE = "#7E8AAD";
const GREY_LABEL = "#5C5E6B";
const RUST       = "#B0453E";

const fontDisplay = { fontFamily: "'Fraunces', Georgia, serif" };
const fontMono    = { fontFamily: "'DM Mono', monospace" };
const fontBody    = { fontFamily: "'Poppins', system-ui, sans-serif" };

// ── DB HELPERS ────────────────────────────────────────────────────────────────
async function dbGetSchedule(): Promise<Schedule> {
  const { data } = await supabase.from("schedule").select("data").eq("id","main").single();
  return (data?.data as Schedule) || [];
}
async function dbSetSchedule(s: Schedule) {
  await supabase.from("schedule").upsert({ id:"main", data: s, updated_at: new Date().toISOString() });
}
async function dbGetChecks(): Promise<Checks> {
  const { data } = await supabase.from("checks").select("data").eq("id","main").single();
  return (data?.data as Checks) || {};
}
async function dbSetChecks(c: Checks) {
  await supabase.from("checks").upsert({ id:"main", data: c, updated_at: new Date().toISOString() });
}
async function dbGetPins(): Promise<Pins> {
  const { data } = await supabase.from("user_pins").select("user_key, pin");
  if (!data?.length) return DEFAULT_PINS;
  const pins: Pins = {};
  for (const row of data as any[]) pins[row.user_key] = row.pin;
  return { ...DEFAULT_PINS, ...pins };
}
async function dbSetPin(userKey: string, pin: string) {
  await supabase.from("user_pins").upsert({ user_key: userKey, pin });
}
async function dbGetAudit(): Promise<AuditLog> {
  const { data } = await supabase.from("audit_log").select("data").eq("id","main").single();
  return (data?.data as AuditLog) || [];
}
async function dbSetAudit(a: AuditLog) {
  await supabase.from("audit_log").upsert({ id:"main", data: a, updated_at: new Date().toISOString() });
}
function logAction(log: AuditLog, actor: string, action: string, detail: string): AuditLog {
  const entry: AuditEntry = { id: uid(), ts: new Date().toISOString(), actor, action, detail };
  const next = [entry, ...log].slice(0, 200); // keep last 200
  dbSetAudit(next);
  return next;
}

// ── TASK HELPERS ──────────────────────────────────────────────────────────────
function taskVisibleTo(task: Task, userKey: ArtistKey) {
  return task.owner === "all" || task.owner === userKey;
}
function isFullyComplete(task: Task, checks: Checks) {
  const c = checks[task.id] || {};
  if (task.owner === "all") return ARTIST_KEYS.every(k => c[k]);
  return !!(c as any)[task.owner];
}
function myCheckState(task: Task, checks: Checks, userKey: ArtistKey) {
  return !!(checks[task.id] || {})[userKey];
}
function teamCheckedCount(task: Task, checks: Checks) {
  return ARTIST_KEYS.filter(k => !!(checks[task.id] || {})[k]).length;
}
function uid() { return Math.random().toString(36).slice(2, 9); }

// Streak: consecutive past days (excluding today) where the artist completed
// ALL of their visible tasks for that day. Walks backward from yesterday.
function calcStreak(schedule: Schedule, checks: Checks, userKey: ArtistKey): number {
  const allDays = schedule.flatMap(m => m.days).filter(d => d.date && d.tasks.some(t => taskVisibleTo(t, userKey)));
  const sorted = allDays.filter(d => d.date! < todayISO()).sort((a,b) => (b.date! < a.date! ? -1 : 1));
  let streak = 0;
  for (const day of sorted) {
    const myTasks = day.tasks.filter(t => taskVisibleTo(t, userKey));
    if (myTasks.length === 0) continue;
    const allDone = myTasks.every(t => myCheckState(t, checks, userKey));
    if (allDone) streak++;
    else break;
  }
  return streak;
}

// ── DATE HELPERS ──────────────────────────────────────────────────────────────
const WEEKDAY_SHORT = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const MONTH_SHORT   = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function fmtDay(date: Date) {
  return `${WEEKDAY_SHORT[date.getDay()]} ${MONTH_SHORT[date.getMonth()]} ${date.getDate()}`;
}
function toISODate(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function generateDays(startDateStr: string, count: number): Day[] {
  const days: Day[] = [];
  const start = new Date(startDateStr + "T00:00:00");
  for (let i = 0; i < count; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push({ id: "d" + uid(), day: fmtDay(d), date: toISODate(d), tasks: [] });
  }
  return days;
}
function todayISO() { return toISODate(new Date()); }
function isOverdue(day: Day) {
  if (!day.date) return false;
  return day.date < todayISO();
}
function isToday(day: Day) {
  if (!day.date) return false;
  return day.date === todayISO();
}

// ── BULK PASTE PARSER ─────────────────────────────────────────────────────────
// Format:
// Day: Tue Jul 1
// All | Reply to comments — 20 min | content
// Dela | Check in with Mobola | admin
function parseBulkText(text: string): { day: string; tasks: Omit<Task,"id">[] }[] {
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  const result: { day: string; tasks: Omit<Task,"id">[] }[] = [];
  let current: { day: string; tasks: Omit<Task,"id">[] } | null = null;
  for (const line of lines) {
    if (/^day\s*:/i.test(line)) {
      if (current) result.push(current);
      current = { day: line.replace(/^day\s*:/i, "").trim(), tasks: [] };
      continue;
    }
    if (!current) continue;
    const parts = line.split("|").map(p => p.trim());
    if (parts.length < 2) continue;
    const [ownerRaw, label, catRaw, noteRaw] = parts;
    const ownerLower = ownerRaw.toLowerCase();
    let owner: Owner = "all";
    if (ownerLower === "dela") owner = "dela";
    else if (ownerLower === "muyii") owner = "muyii";
    else if (ownerLower === "tycoon") owner = "tycoon";
    const catLower = (catRaw || "content").toLowerCase();
    const cat: Cat = catLower.startsWith("mus") ? "music" : catLower.startsWith("adm") ? "admin" : "content";
    if (label) current.tasks.push({ label, owner, cat, ...(noteRaw ? { note: noteRaw } : {}) });
  }
  if (current) result.push(current);
  return result;
}

// ── RECURRING TEMPLATES ───────────────────────────────────────────────────────
interface RecurringTemplate { id: string; label: string; cat: Cat; owner: Owner; }
const RECURRING_STORAGE_KEY = "sintraa_recurring_templates";
function loadTemplates(): RecurringTemplate[] {
  try { return JSON.parse(localStorage.getItem(RECURRING_STORAGE_KEY) || "[]"); } catch { return []; }
}
function saveTemplates(t: RecurringTemplate[]) {
  localStorage.setItem(RECURRING_STORAGE_KEY, JSON.stringify(t));
}

// ── LOADING ───────────────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: NAVY_DEEP }}>
      <div className="text-center">
        <div style={{ ...fontMono, color: GREY_LABEL, letterSpacing: "0.2em" }} className="text-xs uppercase mb-4">Sintraa</div>
        <div className="w-7 h-7 border-2 rounded-full animate-spin mx-auto" style={{ borderColor: PERIWINKLE, borderTopColor: "transparent" }} />
      </div>
    </div>
  );
}

// ── PIN PAD ───────────────────────────────────────────────────────────────────
function PinPad({ title, subtitle, onSubmit, onCancel, error }: {
  title: string; subtitle: string; onSubmit: (pin: string) => void; onCancel?: () => void; error?: boolean;
}) {
  const [pin, setPin] = useState("");
  const [shake, setShake] = useState(false);
  useEffect(() => { if (error) { setShake(true); setPin(""); setTimeout(() => setShake(false), 450); } }, [error]);
  const handleDigit = (d: string) => {
    if (pin.length >= 4) return;
    const next = pin + d;
    setPin(next);
    if (next.length === 4) setTimeout(() => onSubmit(next), 150);
  };
  return (
    <div className={`w-full max-w-xs ${shake ? "animate-bounce" : ""}`}>
      <h2 style={{ ...fontDisplay, color: CREAM }} className="text-xl font-semibold text-center mb-1">{title}</h2>
      <p style={{ ...fontMono, color: GREY_LABEL }} className="text-xs text-center mb-6 uppercase tracking-wider">{subtitle}</p>
      <div className="flex justify-center gap-4 mb-5">
        {[0,1,2,3].map(i => (
          <div key={i} className="w-3 h-3 rounded-full border transition-all"
            style={{ borderColor: error ? RUST : PERIWINKLE, backgroundColor: pin.length > i ? (error ? RUST : PERIWINKLE) : "transparent" }} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[1,2,3,4,5,6,7,8,9].map(d => (
          <button key={d} onClick={() => handleDigit(String(d))}
            style={{ ...fontMono, backgroundColor: NAVY_MID, color: CREAM, border: `1px solid ${GREY_LABEL}40` }}
            className="h-12 rounded-lg text-base transition-all active:scale-95 hover:opacity-80">{d}</button>
        ))}
        {onCancel
          ? <button onClick={onCancel} style={{ ...fontMono, color: GREY_LABEL, border: `1px solid ${GREY_LABEL}40` }} className="h-12 rounded-lg text-xs uppercase">Cancel</button>
          : <div />}
        <button onClick={() => handleDigit("0")}
          style={{ ...fontMono, backgroundColor: NAVY_MID, color: CREAM, border: `1px solid ${GREY_LABEL}40` }}
          className="h-12 rounded-lg text-base transition-all active:scale-95 hover:opacity-80">0</button>
        <button onClick={() => setPin(p => p.slice(0,-1))}
          style={{ ...fontMono, color: GREY_LABEL, border: `1px solid ${GREY_LABEL}40` }}
          className="h-12 rounded-lg text-lg flex items-center justify-center">⌫</button>
      </div>
    </div>
  );
}

// ── LOGIN SCREEN ──────────────────────────────────────────────────────────────
function LoginScreen({ pins, onLogin }: { pins: Pins; onLogin: (key: UserKey) => void }) {
  const [selected, setSelected] = useState<UserKey | null>(null);
  const [error, setError] = useState(false);
  const handlePin = (pin: string) => {
    if (!selected) return;
    if (pins[selected] === pin) { onLogin(selected); }
    else { setError(true); setTimeout(() => setError(false), 10); }
  };
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ backgroundColor: NAVY_DEEP }}>
      <div className="mb-10 text-center">
        <div style={{ ...fontMono, color: GREY_LABEL, letterSpacing: "0.25em" }} className="text-xs uppercase mb-3">Sintraa</div>
        <h1 style={{ ...fontDisplay, color: CREAM }} className="text-3xl font-semibold">
          Task <span style={{ fontStyle: "italic", color: BLUE_SOFT }}>Schedule</span>
        </h1>
      </div>
      {!selected ? (
        <div className="flex flex-col gap-3 w-full max-w-xs">
          {ARTIST_KEYS.map(key => (
            <button key={key} onClick={() => setSelected(key)}
              style={{ ...fontBody, backgroundColor: NAVY_MID, color: CREAM, border: `1px solid ${GREY_LABEL}40` }}
              className="w-full py-4 rounded-xl text-base font-medium transition-all active:scale-95 hover:opacity-90">
              {USERS[key].label}
            </button>
          ))}
          <button onClick={() => setSelected("manager")}
            style={{ ...fontMono, color: GREY_LABEL }}
            className="w-full py-3 text-xs uppercase tracking-wider mt-2 hover:text-white transition-all">
            Manager →
          </button>
        </div>
      ) : (
        <PinPad title={USERS[selected].label} subtitle="Enter PIN" onSubmit={handlePin} onCancel={() => setSelected(null)} error={error} />
      )}
    </div>
  );
}

// ── CHANGE PIN MODAL ──────────────────────────────────────────────────────────
function ChangePinModal({ onClose, onSave }: { onClose: () => void; onSave: (pin: string) => void }) {
  const [step, setStep] = useState<"new" | "confirm">("new");
  const [firstPin, setFirstPin] = useState("");
  const [error, setError] = useState(false);
  const handleFirst = (pin: string) => { setFirstPin(pin); setStep("confirm"); };
  const handleConfirm = (pin: string) => {
    if (pin === firstPin) onSave(pin);
    else { setError(true); setTimeout(() => { setError(false); setStep("new"); setFirstPin(""); }, 500); }
  };
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 px-6" style={{ backgroundColor: "#000000B0" }}>
      <div className="rounded-2xl p-8 w-full max-w-xs" style={{ backgroundColor: NAVY_MID, border: `1px solid ${GREY_LABEL}40` }}>
        {step === "new"
          ? <PinPad title="New PIN" subtitle="Choose a 4-digit PIN" onSubmit={handleFirst} onCancel={onClose} />
          : <PinPad title="Confirm PIN" subtitle="Enter it again" onSubmit={handleConfirm} onCancel={onClose} error={error} />}
      </div>
    </div>
  );
}

// ── CREATE MONTH MODAL ────────────────────────────────────────────────────────
function CreateMonthModal({ onSave, onCancel }: {
  onSave: (title: string, startDate: string, count: number) => void; onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [startDate, setStartDate] = useState("");
  const [count, setCount] = useState("31");
  const valid = title.trim() && startDate && Number(count) > 0;
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 px-6" style={{ backgroundColor: "#000000B0" }}>
      <div className="rounded-2xl p-6 w-full max-w-sm" style={{ backgroundColor: NAVY_MID, border: `1px solid ${GREY_LABEL}40` }}>
        <h3 style={{ ...fontDisplay, color: CREAM }} className="text-lg font-semibold mb-1">New Month</h3>
        <p style={{ ...fontMono, color: GREY_LABEL }} className="text-[10px] mb-4 uppercase tracking-wider">Days auto-generate from start date</p>
        <input value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. August Release Prep"
          style={{ ...fontBody, backgroundColor: NAVY_DEEP, color: CREAM, border: `1px solid ${GREY_LABEL}40` }}
          className="w-full rounded-xl px-3 py-2.5 text-sm mb-3 focus:outline-none" />
        <label style={{ ...fontMono, color: GREY_LABEL }} className="text-[10px] uppercase tracking-wider block mb-1">Start date</label>
        <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)}
          style={{ ...fontBody, backgroundColor: NAVY_DEEP, color: CREAM, border: `1px solid ${GREY_LABEL}40` }}
          className="w-full rounded-xl px-3 py-2.5 text-sm mb-3 focus:outline-none" />
        <label style={{ ...fontMono, color: GREY_LABEL }} className="text-[10px] uppercase tracking-wider block mb-1">Number of days</label>
        <input type="number" value={count} onChange={e => setCount(e.target.value)} min="1" max="31"
          style={{ ...fontBody, backgroundColor: NAVY_DEEP, color: CREAM, border: `1px solid ${GREY_LABEL}40` }}
          className="w-full rounded-xl px-3 py-2.5 text-sm mb-5 focus:outline-none" />
        <div className="flex gap-2">
          <button onClick={onCancel} style={{ ...fontBody, color: GREY_LABEL, border: `1px solid ${GREY_LABEL}40` }} className="flex-1 py-2.5 rounded-xl text-sm">Cancel</button>
          <button onClick={() => valid && onSave(title.trim(), startDate, Number(count))} disabled={!valid}
            style={{ ...fontBody, backgroundColor: CREAM, color: NAVY_DEEP }}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-30">Create</button>
        </div>
      </div>
    </div>
  );
}

// ── BULK PASTE MODAL ──────────────────────────────────────────────────────────
function BulkPasteModal({ onSave, onCancel }: {
  onSave: (parsed: { day: string; tasks: Omit<Task,"id">[] }[]) => void; onCancel: () => void;
}) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState<{ day: string; tasks: Omit<Task,"id">[] }[] | null>(null);
  const handlePreview = () => setPreview(parseBulkText(text));
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 px-4 py-8" style={{ backgroundColor: "#000000B0" }}>
      <div className="rounded-2xl p-6 w-full max-w-lg max-h-full overflow-y-auto" style={{ backgroundColor: NAVY_MID, border: `1px solid ${GREY_LABEL}40` }}>
        <h3 style={{ ...fontDisplay, color: CREAM }} className="text-lg font-semibold mb-1">Bulk Import Tasks</h3>
        <p style={{ ...fontMono, color: GREY_LABEL }} className="text-[10px] mb-1 uppercase tracking-wider">Paste in this format:</p>
        <pre style={{ ...fontMono, color: `${GREY_LABEL}`, backgroundColor: NAVY_DEEP, fontSize: "10px" }} className="rounded-lg p-2 mb-3 text-xs leading-relaxed">
{`Day: Tue Jul 1
All | Reply to comments — 20 min | content
Dela | Check in with Mobola | admin
Dela | Shoot 3 content pieces | content

Day: Wed Jul 2
All | Post 1x TikTok | content
Muyii | Visualizer shoot Day 2 | music`}
        </pre>
        <textarea value={text} onChange={e => { setText(e.target.value); setPreview(null); }}
          placeholder="Paste your tasks here..."
          rows={10}
          style={{ ...fontMono, backgroundColor: NAVY_DEEP, color: CREAM, border: `1px solid ${GREY_LABEL}40`, fontSize: "12px" }}
          className="w-full rounded-xl px-3 py-2.5 mb-3 resize-none focus:outline-none" />
        {preview !== null && (
          <div className="mb-3 rounded-xl p-3 max-h-40 overflow-y-auto" style={{ backgroundColor: NAVY_DEEP, border: `1px solid ${GREY_LABEL}30` }}>
            {preview.length === 0
              ? <p style={{ ...fontMono, color: RUST }} className="text-xs">No valid days found — check the format.</p>
              : preview.map((d, i) => (
                <div key={i} className="mb-1">
                  <span style={{ ...fontMono, color: PERIWINKLE }} className="text-xs">{d.day}</span>
                  <span style={{ ...fontMono, color: GREY_LABEL }} className="text-xs"> · {d.tasks.length} task{d.tasks.length !== 1 ? "s" : ""}</span>
                </div>
              ))}
            {preview.length > 0 && (
              <p style={{ ...fontMono, color: BLUE_SOFT }} className="text-xs mt-2 pt-2 border-t border-gray-700">
                {preview.reduce((a, d) => a + d.tasks.length, 0)} total tasks across {preview.length} days
              </p>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={onCancel} style={{ ...fontBody, color: GREY_LABEL, border: `1px solid ${GREY_LABEL}40` }} className="flex-1 py-2.5 rounded-xl text-sm">Cancel</button>
          {!preview
            ? <button onClick={handlePreview} disabled={!text.trim()}
                style={{ ...fontBody, color: CREAM, border: `1px solid ${GREY_LABEL}40` }}
                className="flex-1 py-2.5 rounded-xl text-sm disabled:opacity-30">Preview</button>
            : <button onClick={() => preview.length > 0 && onSave(preview)} disabled={preview.length === 0}
                style={{ ...fontBody, backgroundColor: CREAM, color: NAVY_DEEP }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-30">Import {preview.reduce((a,d)=>a+d.tasks.length,0)} Tasks</button>
          }
        </div>
      </div>
    </div>
  );
}

// ── TASK FORM ─────────────────────────────────────────────────────────────────
function TaskForm({ initial, onSave, onCancel }: { initial?: Task; onSave: (d: Omit<Task,"id">) => void; onCancel: () => void }) {
  const [label, setLabel] = useState(initial?.label || "");
  const [cat, setCat]     = useState<Cat>(initial?.cat || "music");
  const [owner, setOwner] = useState<Owner>(initial?.owner || "all");
  const [saveTemplate, setSaveTemplate] = useState(false);
  const [templates, setTemplatesState] = useState<RecurringTemplate[]>(loadTemplates());

  const applyTemplate = (t: RecurringTemplate) => { setLabel(t.label); setCat(t.cat); setOwner(t.owner); };

  const handleSave = () => {
    if (!label.trim()) return;
    if (saveTemplate) {
      const next = [...templates, { id: uid(), label: label.trim(), cat, owner }];
      saveTemplates(next);
    }
    onSave({ label: label.trim(), cat, owner });
  };

  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 px-6" style={{ backgroundColor: "#000000B0" }}>
      <div className="rounded-2xl p-6 w-full max-w-sm max-h-[90vh] overflow-y-auto" style={{ backgroundColor: NAVY_MID, border: `1px solid ${GREY_LABEL}40` }}>
        <h3 style={{ ...fontDisplay, color: CREAM }} className="text-lg font-semibold mb-3">{initial ? "Edit Task" : "Add Task"}</h3>

        {!initial && templates.length > 0 && (
          <div className="mb-3">
            <p style={{ ...fontMono, color: GREY_LABEL }} className="text-[10px] uppercase tracking-wider mb-1.5">Quick templates</p>
            <div className="flex gap-1.5 flex-wrap">
              {templates.map(t => (
                <button key={t.id} onClick={() => applyTemplate(t)}
                  style={{ ...fontMono, color: PERIWINKLE, border: `1px solid ${PERIWINKLE}50` }}
                  className="text-[10px] px-2 py-1 rounded-md">{t.label.slice(0, 24)}{t.label.length > 24 ? "…" : ""}</button>
              ))}
            </div>
          </div>
        )}

        <textarea value={label} onChange={e => setLabel(e.target.value)} placeholder="Task description..." rows={3}
          style={{ ...fontBody, backgroundColor: NAVY_DEEP, color: CREAM, border: `1px solid ${GREY_LABEL}40` }}
          className="w-full rounded-xl px-3 py-2.5 text-sm resize-none mb-3 focus:outline-none" />
        <div className="flex gap-2 mb-3">
          {(["music","content","admin"] as Cat[]).map(c => (
            <button key={c} onClick={() => setCat(c)}
              style={{ ...fontMono, backgroundColor: cat === c ? CREAM : "transparent", color: cat === c ? NAVY_DEEP : GREY_LABEL, border: `1px solid ${GREY_LABEL}40` }}
              className="flex-1 py-1.5 rounded-lg text-xs uppercase tracking-wide transition-all">{CAT_LABEL[c]}</button>
          ))}
        </div>
        <div className="flex gap-2 mb-3 flex-wrap">
          {([["all","All"],["dela","Dela"],["muyii","Muyii"],["tycoon","TYCOON"]] as [Owner,string][]).map(([val,lbl]) => (
            <button key={val} onClick={() => setOwner(val)}
              style={{ ...fontMono, backgroundColor: owner === val ? CREAM : "transparent", color: owner === val ? NAVY_DEEP : GREY_LABEL, border: `1px solid ${GREY_LABEL}40` }}
              className="px-3 py-1 rounded-full text-xs uppercase tracking-wide transition-all">{lbl}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 mb-5 cursor-pointer">
          <input type="checkbox" checked={saveTemplate} onChange={e => setSaveTemplate(e.target.checked)} className="w-3.5 h-3.5" />
          <span style={{ ...fontMono, color: GREY_LABEL }} className="text-[10px] uppercase">Save as reusable template</span>
        </label>
        <div className="flex gap-2">
          <button onClick={onCancel} style={{ ...fontBody, color: GREY_LABEL, border: `1px solid ${GREY_LABEL}40` }} className="flex-1 py-2.5 rounded-xl text-sm">Cancel</button>
          <button onClick={handleSave} disabled={!label.trim()}
            style={{ ...fontBody, backgroundColor: CREAM, color: NAVY_DEEP }}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-30">Save</button>
        </div>
      </div>
    </div>
  );
}

// ── ARTIST VIEW ───────────────────────────────────────────────────────────────
function ArtistView({ userKey, schedule, checks, onToggle, onLogout, onChangePin, onReact, onAddNote }: {
  userKey: ArtistKey; schedule: Schedule; checks: Checks;
  onToggle: (task: Task, key: ArtistKey) => void; onLogout: () => void; onChangePin: () => void;
  onReact: (task: Task, emoji: string) => void; onAddNote: (task: Task, note: string) => void;
}) {
  const [activeMonth, setActiveMonth] = useState(0);
  const [tab, setTab] = useState<"today" | "month">("today");
  const [noteEditing, setNoteEditing] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const myColor = ARTIST_COLOR[userKey];

  const month = schedule[activeMonth];
  const myTasks = schedule.flatMap(m => m.days.flatMap(d => d.tasks.filter(t => taskVisibleTo(t, userKey))));
  const myDone  = myTasks.filter(t => myCheckState(t, checks, userKey)).length;
  const pct     = myTasks.length ? Math.round((myDone / myTasks.length) * 100) : 0;
  const streak  = calcStreak(schedule, checks, userKey);

  const allDaysFlat = schedule.flatMap(m => m.days);
  const todayDay = allDaysFlat.find(d => isToday(d));
  const overdueDays = allDaysFlat.filter(d => isOverdue(d) && d.tasks.some(t => taskVisibleTo(t, userKey) && !myCheckState(t, checks, userKey)));

  if (!schedule.length) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 text-center" style={{ backgroundColor: NAVY_DEEP }}>
        <div>
          <p style={{ ...fontDisplay, color: CREAM }} className="text-xl mb-2">No schedule yet</p>
          <p style={{ ...fontMono, color: GREY_LABEL }} className="text-xs uppercase tracking-wider">Waiting on the manager</p>
        </div>
      </div>
    );
  }

  const renderTaskCard = (task: Task, dayId: string) => {
    const mine  = myCheckState(task, checks, userKey);
    const full  = isFullyComplete(task, checks);
    const isAll = task.owner === "all";
    const count = isAll ? teamCheckedCount(task, checks) : 0;
    const editingThis = noteEditing === task.id;
    const myReaction = task.reactions?.[userKey];

    return (
      <div key={task.id}
        style={{ backgroundColor: NAVY_MID, border: `1px solid ${myColor}40`, opacity: full ? 0.5 : 1 }}
        className="flex flex-col gap-2 px-4 py-3.5 rounded-xl transition-opacity">
        <div className="flex items-start gap-3">
          <button onClick={() => onToggle(task, userKey)}
            style={{ borderColor: mine ? myColor : `${GREY_LABEL}80`, backgroundColor: mine ? myColor : "transparent" }}
            className="mt-0.5 w-5 h-5 shrink-0 rounded-md border-2 flex items-center justify-center transition-all active:scale-90">
            {mine && <svg className="w-3 h-3" fill="none" viewBox="0 0 12 12"><path d="M2 6l3 3 5-5" stroke={NAVY_DEEP} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>}
          </button>
          <div className="flex-1 min-w-0">
            <span style={{ ...fontBody, color: full ? GREY_LABEL : mine ? CREAM_DIM : CREAM, textDecoration: full ? "line-through" : "none" }} className="text-sm">
              {task.label}
            </span>
            {isAll && (
              <div className="mt-1.5 flex items-center gap-2 flex-wrap">
                <span style={{ ...fontMono, color: count === 3 ? BLUE_SOFT : GREY_LABEL, border: `1px solid ${GREY_LABEL}40` }} className="text-[10px] px-2 py-0.5 rounded-full uppercase">{count}/3</span>
                {ARTIST_KEYS.map(k => {
                  const kd = !!(checks[task.id] || {})[k];
                  return <span key={k} style={{ ...fontMono, color: kd ? ARTIST_COLOR[k] : `${GREY_LABEL}80` }} className="text-[10px]">{kd ? "✓" : "·"} {USERS[k].label}</span>;
                })}
              </div>
            )}
            {task.note && !editingThis && (
              <p style={{ ...fontMono, color: PERIWINKLE }} className="text-[11px] mt-1.5 italic">"{task.note}"</p>
            )}
          </div>
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 mt-1.5 ${CAT_DOT[task.cat]}`} />
        </div>

        {editingThis ? (
          <div className="flex gap-2 pl-8">
            <input value={noteDraft} onChange={e => setNoteDraft(e.target.value)} placeholder="Add a note..."
              style={{ ...fontBody, backgroundColor: NAVY_DEEP, color: CREAM, border: `1px solid ${GREY_LABEL}40` }}
              className="flex-1 rounded-lg px-2 py-1.5 text-xs focus:outline-none" />
            <button onClick={() => { onAddNote(task, noteDraft); setNoteEditing(null); }}
              style={{ ...fontMono, backgroundColor: CREAM, color: NAVY_DEEP }} className="px-2.5 rounded-lg text-[10px] uppercase">Save</button>
          </div>
        ) : (
          <div className="flex items-center gap-3 pl-8">
            <button onClick={() => { setNoteEditing(task.id); setNoteDraft(task.note || ""); }}
              style={{ ...fontMono, color: GREY_LABEL }} className="text-[10px] uppercase hover:text-white">
              {task.note ? "Edit note" : "+ Note"}
            </button>
            <div className="flex gap-1">
              {REACTION_EMOJIS.map(emoji => (
                <button key={emoji} onClick={() => onReact(task, emoji)}
                  style={{ opacity: myReaction === emoji ? 1 : 0.4 }}
                  className="text-xs transition-opacity hover:opacity-100">{emoji}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: NAVY_DEEP, color: CREAM }}>
      {/* Header */}
      <div className="px-6 py-5" style={{ borderBottom: `1px solid ${GREY_LABEL}30` }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <div style={{ ...fontMono, color: GREY_LABEL, letterSpacing: "0.2em" }} className="text-xs uppercase mb-1">Sintraa</div>
            <h1 style={{ ...fontDisplay, color: myColor }} className="text-2xl font-semibold">{USERS[userKey].label}</h1>
          </div>
          <div className="text-right">
            <div style={{ ...fontDisplay, color: BLUE_SOFT }} className="text-3xl font-semibold">{pct}%</div>
            <div style={{ ...fontMono, color: GREY_LABEL }} className="text-xs mb-1">{myDone}/{myTasks.length}</div>
            <button onClick={onChangePin} style={{ ...fontMono, color: GREY_LABEL }} className="text-xs underline block ml-auto mb-0.5 hover:text-white">PIN</button>
            <button onClick={onLogout} style={{ ...fontMono, color: GREY_LABEL }} className="text-xs underline block ml-auto hover:text-white">Switch</button>
          </div>
        </div>
        {streak > 0 && (
          <div style={{ ...fontMono, color: "#E8A23D" }} className="text-xs">🔥 {streak} day streak</div>
        )}
        {overdueDays.length > 0 && (
          <div style={{ ...fontMono, color: RUST }} className="text-xs mt-1">⚠ {overdueDays.length} day{overdueDays.length !== 1 ? "s" : ""} with unfinished tasks</div>
        )}
      </div>

      {/* Tab switcher */}
      <div className="px-6 pt-4 flex gap-2">
        <button onClick={() => setTab("today")}
          style={{ ...fontMono, backgroundColor: tab === "today" ? myColor : "transparent", color: tab === "today" ? NAVY_DEEP : GREY_LABEL, border: `1px solid ${myColor}60` }}
          className="px-4 py-2 rounded-lg text-xs uppercase tracking-wide">Today</button>
        <button onClick={() => setTab("month")}
          style={{ ...fontMono, backgroundColor: tab === "month" ? NAVY_MID : "transparent", color: tab === "month" ? CREAM : GREY_LABEL, border: `1px solid ${GREY_LABEL}40` }}
          className="px-4 py-2 rounded-lg text-xs uppercase tracking-wide">Full Month</button>
      </div>

      {tab === "today" ? (
        <div className="px-6 pt-6 pb-16">
          {overdueDays.length > 0 && (
            <div className="mb-8">
              <div className="flex items-center gap-3 mb-3">
                <span style={{ ...fontMono, color: RUST }} className="text-xs uppercase tracking-widest">Overdue</span>
                <div className="flex-1 h-px" style={{ backgroundColor: `${RUST}30` }} />
              </div>
              {overdueDays.map(day => (
                <div key={day.id} className="mb-4">
                  <div style={{ ...fontMono, color: `${RUST}CC` }} className="text-[11px] uppercase mb-2">{day.day}</div>
                  <div className="space-y-2">
                    {day.tasks.filter(t => taskVisibleTo(t, userKey)).map(t => renderTaskCard(t, day.id))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-3 mb-3">
            <span style={{ ...fontMono, color: myColor }} className="text-xs uppercase tracking-widest">
              {todayDay ? todayDay.day : "Today"}
            </span>
            <div className="flex-1 h-px" style={{ backgroundColor: `${GREY_LABEL}30` }} />
          </div>
          {todayDay ? (
            <div className="space-y-2">
              {todayDay.tasks.filter(t => taskVisibleTo(t, userKey)).length === 0
                ? <p style={{ ...fontMono, color: GREY_LABEL }} className="text-xs">Nothing assigned to you today.</p>
                : todayDay.tasks.filter(t => taskVisibleTo(t, userKey)).map(t => renderTaskCard(t, todayDay.id))}
            </div>
          ) : (
            <p style={{ ...fontMono, color: GREY_LABEL }} className="text-xs">No schedule entry for today yet.</p>
          )}
        </div>
      ) : (
        <>
          <div className="px-6 pt-4 flex gap-2 overflow-x-auto pb-1">
            {schedule.map((m, mi) => {
              const mt = m.days.flatMap(d => d.tasks.filter(t => taskVisibleTo(t, userKey)));
              const md = mt.filter(t => myCheckState(t, checks, userKey)).length;
              return (
                <button key={m.id} onClick={() => setActiveMonth(mi)}
                  style={{ ...fontMono, backgroundColor: activeMonth === mi ? NAVY_MID : "transparent", color: activeMonth === mi ? CREAM : GREY_LABEL, border: `1px solid ${GREY_LABEL}40` }}
                  className="shrink-0 px-4 py-2 rounded-lg text-xs uppercase tracking-wide transition-all">
                  <div>{m.title}</div>
                  <div className="text-[10px] mt-0.5 opacity-70">{md}/{mt.length}</div>
                </button>
              );
            })}
          </div>

          <div className="px-6 pt-6 pb-2">
            <h2 style={{ ...fontDisplay, color: CREAM }} className="text-lg font-semibold">{month?.title}</h2>
          </div>

          <div className="px-6 pb-16 space-y-7">
            {month?.days.filter(d => d.tasks.some(t => taskVisibleTo(t, userKey))).map(day => {
              const visible = day.tasks.filter(t => taskVisibleTo(t, userKey));
              const overdue = isOverdue(day);
              const today = isToday(day);
              return (
                <div key={day.id}>
                  <div className="flex items-center gap-3 mb-3">
                    <span style={{ ...fontMono, color: overdue ? RUST : today ? myColor : PERIWINKLE }} className="text-xs uppercase tracking-widest">
                      {day.day} {overdue && "⚠"} {today && "•"}
                    </span>
                    <div className="flex-1 h-px" style={{ backgroundColor: `${GREY_LABEL}30` }} />
                  </div>
                  <div className="space-y-2">
                    {visible.map(t => renderTaskCard(t, day.id))}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}

function ManagerView({ schedule, checks, audit, onScheduleChange, onLogout, onChangePin }: {
  schedule: Schedule; checks: Checks; audit: AuditLog;
  onScheduleChange: (s: Schedule, logDetail?: string) => void; onLogout: () => void; onChangePin: () => void;
}) {
  const [activeMonth, setActiveMonth] = useState(0);
  const [modal, setModal] = useState<
    | { type:"addTask"; dayId:string } | { type:"editTask"; task:Task }
    | { type:"addMonth" } | { type:"bulkPaste" } | { type:"audit" } | null
  >(null);
  const [toast, setToast] = useState<string | null>(null);
  const [showEmptyDays, setShowEmptyDays] = useState(false);

  const month = schedule[activeMonth];
  const allTasks = schedule.flatMap(m => m.days.flatMap(d => d.tasks));
  const artistStats = ARTIST_KEYS.map(key => {
    const mt = allTasks.filter(t => taskVisibleTo(t, key));
    const md = mt.filter(t => !!(checks[t.id] || {})[key]).length;
    const streak = calcStreak(schedule, checks, key);
    return { key, label: USERS[key].label, done: md, total: mt.length, streak };
  });

  const mutate = (fn: (s: Schedule) => Schedule, detail?: string) => {
    onScheduleChange(fn(JSON.parse(JSON.stringify(schedule))), detail);
  };

  const addMonth = (title: string, startDate: string, count: number) => {
    const days = generateDays(startDate, count);
    const newMonth: Month = { id: "m" + uid(), title, days };
    mutate(s => { s.push(newMonth); return s; }, `Created month "${title}" (${count} days)`);
    setActiveMonth(schedule.length);
    setModal(null);
  };

  const addTask = (dayId: string, data: Omit<Task,"id">) => {
    mutate(s => {
      for (const m of s) for (const d of m.days)
        if (d.id === dayId) { d.tasks.push({ id:"t"+uid(), ...data }); break; }
      return s;
    }, `Added task "${data.label}"`);
    setModal(null);
  };

  const editTask = (taskId: string, data: Omit<Task,"id">) => {
    mutate(s => {
      for (const m of s) for (const d of m.days) for (const t of d.tasks)
        if (t.id === taskId) { Object.assign(t, data); break; }
      return s;
    }, `Edited task "${data.label}"`);
    setModal(null);
  };

  const deleteTask = (taskId: string) => {
    let label = "";
    mutate(s => {
      for (const m of s) for (const d of m.days) {
        const found = d.tasks.find(t => t.id === taskId);
        if (found) label = found.label;
        d.tasks = d.tasks.filter(t => t.id !== taskId);
      }
      return s;
    }, `Deleted task "${label}"`);
  };

  const deleteMonth = (monthId: string) => {
    const m = schedule.find(x => x.id === monthId);
    mutate(s => s.filter(x => x.id !== monthId), `Deleted month "${m?.title}"`);
    setActiveMonth(0);
  };

  const handleBulkImport = (parsed: { day: string; tasks: Omit<Task,"id">[] }[]) => {
    if (!month) return;
    const totalTasks = parsed.reduce((a, d) => a + d.tasks.length, 0);
    mutate(s => {
      const m = s.find(x => x.id === month.id);
      if (!m) return s;
      for (const { day, tasks } of parsed) {
        let existingDay = m.days.find(d => d.day.toLowerCase() === day.toLowerCase());
        if (!existingDay) {
          existingDay = { id: "d" + uid(), day, tasks: [] };
          m.days.push(existingDay);
        }
        for (const task of tasks) existingDay.tasks.push({ id: "t" + uid(), ...task });
      }
      return s;
    }, `Bulk imported ${totalTasks} tasks across ${parsed.length} days`);
    setModal(null);
    setToast(`Imported ${totalTasks} tasks across ${parsed.length} days`);
    setTimeout(() => setToast(null), 4000);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const exportPDF = () => {
    if (!month) return;
    const win = window.open("", "_blank");
    if (!win) return;
    const rows = month.days.map(day => {
      const taskRows = day.tasks.map(t => {
        const c = checks[t.id] || {};
        const status = isFullyComplete(t, checks) ? "Complete" :
          ARTIST_KEYS.filter(k => c[k]).map(k => USERS[k].label).join(", ") || "Not started";
        const owner = t.owner === "all" ? "All Artists" : USERS[t.owner as UserKey]?.label;
        return `<tr><td>${t.label}</td><td>${owner}</td><td>${CAT_LABEL[t.cat]}</td><td>${status}</td></tr>`;
      }).join("");
      return `<h3>${day.day}</h3><table><tr><th>Task</th><th>Owner</th><th>Category</th><th>Status</th></tr>${taskRows}</table>`;
    }).join("");
    win.document.write(`
      <html><head><title>${month.title}</title>
      <style>
        body { font-family: Georgia, serif; padding: 40px; color: #1a1a1a; }
        h1 { border-bottom: 2px solid #1a1a1a; padding-bottom: 10px; }
        h3 { margin-top: 24px; color: #333; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 13px; }
        th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; }
        th { background: #f0f0f0; }
      </style></head>
      <body><h1>Sintraa &mdash; ${month.title}</h1>${rows}</body></html>
    `);
    win.document.close();
    win.print();
  };

  return (
    <div className="min-h-screen" style={{ backgroundColor: NAVY_DEEP, color: CREAM }}>
      {modal?.type === "addTask"   && <TaskForm onSave={d => addTask(modal.dayId, d)} onCancel={() => setModal(null)} />}
      {modal?.type === "editTask"  && <TaskForm initial={modal.task} onSave={d => editTask(modal.task.id, d)} onCancel={() => setModal(null)} />}
      {modal?.type === "addMonth"  && <CreateMonthModal onSave={addMonth} onCancel={() => setModal(null)} />}
      {modal?.type === "bulkPaste" && <BulkPasteModal onSave={handleBulkImport} onCancel={() => setModal(null)} />}
      {modal?.type === "audit"     && <AuditLogModal audit={audit} onClose={() => setModal(null)} />}

      <div className="px-6 py-5 flex items-center justify-between" style={{ borderBottom: `1px solid ${GREY_LABEL}30` }}>
        <div>
          <div style={{ ...fontMono, color: GREY_LABEL, letterSpacing: "0.2em" }} className="text-xs uppercase mb-1">Sintraa · Manager</div>
          <h1 style={{ ...fontDisplay, color: CREAM }} className="text-xl font-semibold">Overview</h1>
        </div>
        <div className="text-right">
          <button onClick={onChangePin} style={{ ...fontMono, color: GREY_LABEL }} className="text-xs underline block ml-auto mb-1 hover:text-white">PIN</button>
          <button onClick={onLogout} style={{ ...fontMono, color: GREY_LABEL, border: `1px solid ${GREY_LABEL}40` }} className="text-xs px-3 py-1.5 rounded-lg">Switch</button>
        </div>
      </div>

      <div className="px-6 pt-5 grid grid-cols-3 gap-3">
        {artistStats.map(({ key, label, done, total, streak }) => {
          const p = total ? Math.round((done / total) * 100) : 0;
          const color = ARTIST_COLOR[key];
          return (
            <div key={key} className="rounded-2xl p-4" style={{ backgroundColor: NAVY_MID, border: `1px solid ${color}50` }}>
              <div style={{ ...fontMono, color }} className="text-xs uppercase mb-1">{label}</div>
              <div style={{ ...fontDisplay, color: CREAM }} className="text-2xl font-semibold">{p}%</div>
              <div style={{ ...fontMono, color: GREY_LABEL }} className="text-[10px] mb-2">{done}/{total}</div>
              {streak > 0 && <div style={{ ...fontMono, color: "#E8A23D" }} className="text-[10px] mb-2">Streak {streak}d</div>}
              <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: `${GREY_LABEL}30` }}>
                <div className="h-full rounded-full" style={{ width: `${p}%`, backgroundColor: color }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-6 pt-4 flex gap-2 flex-wrap">
        <button onClick={() => setModal({ type:"audit" })}
          style={{ ...fontMono, color: GREY_LABEL, border: `1px solid ${GREY_LABEL}40` }}
          className="text-[10px] px-2.5 py-1 rounded-md uppercase">Activity Log</button>
        {month && (
          <button onClick={exportPDF}
            style={{ ...fontMono, color: GREY_LABEL, border: `1px solid ${GREY_LABEL}40` }}
            className="text-[10px] px-2.5 py-1 rounded-md uppercase">Export PDF</button>
        )}
      </div>

      <div className="px-6 pt-5 flex gap-2 overflow-x-auto pb-1 items-center">
        {schedule.map((m, mi) => (
          <button key={m.id} onClick={() => setActiveMonth(mi)}
            style={{ ...fontMono, backgroundColor: activeMonth === mi ? NAVY_MID : "transparent", color: activeMonth === mi ? CREAM : GREY_LABEL, border: `1px solid ${GREY_LABEL}40` }}
            className="shrink-0 px-4 py-2 rounded-lg text-xs uppercase tracking-wide">{m.title}</button>
        ))}
        <button onClick={() => setModal({ type:"addMonth" })}
          style={{ ...fontMono, color: GREY_LABEL, border: `1px dashed ${GREY_LABEL}60` }}
          className="shrink-0 px-3 py-2 rounded-lg text-xs uppercase">+ Month</button>
      </div>

      {month && (
        <>
          <div className="px-6 pt-6 pb-2 flex items-center justify-between flex-wrap gap-2">
            <h2 style={{ ...fontDisplay, color: CREAM }} className="text-lg font-semibold">{month.title}</h2>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => setModal({ type:"bulkPaste" })}
                style={{ ...fontMono, color: BLUE_SOFT, border: `1px solid ${BLUE_SOFT}60` }}
                className="text-xs px-2.5 py-1 rounded-md uppercase">Bulk Import</button>
              <button onClick={() => deleteMonth(month.id)}
                style={{ ...fontMono, color: RUST, border: `1px solid ${RUST}50` }}
                className="text-xs px-2.5 py-1 rounded-md uppercase">Delete Month</button>
            </div>
          </div>

          <div className="px-6 pb-16 space-y-7">
            {month.days.filter(d => d.tasks.length > 0).map(day => {
              const overdue = isOverdue(day);
              const today = isToday(day);
              return (
                <div key={day.id}>
                  <div className="flex items-center gap-3 mb-3">
                    <span style={{ ...fontMono, color: overdue ? RUST : today ? BLUE_SOFT : PERIWINKLE }} className="text-xs uppercase tracking-widest">
                      {day.day} {overdue ? "(overdue)" : ""} {today ? "(today)" : ""}
                    </span>
                    <div className="flex-1 h-px" style={{ backgroundColor: `${GREY_LABEL}30` }} />
                    <button onClick={() => setModal({ type:"addTask", dayId: day.id })}
                      style={{ ...fontMono, color: GREY_LABEL, border: `1px solid ${GREY_LABEL}40` }}
                      className="text-[10px] px-2 py-0.5 rounded-md uppercase">+ Task</button>
                  </div>
                  <div className="space-y-2">
                    {day.tasks.map(task => {
                      const full = isFullyComplete(task, checks);
                      const c = checks[task.id] || {};
                      const owners = task.owner === "all" ? ARTIST_KEYS : ARTIST_KEYS.includes(task.owner as ArtistKey) ? [task.owner as ArtistKey] : [];
                      const borderColor = task.owner !== "all" && ARTIST_KEYS.includes(task.owner as ArtistKey) ? ARTIST_COLOR[task.owner as ArtistKey] : GREY_LABEL;
                      return (
                        <div key={task.id} style={{ backgroundColor: NAVY_MID, border: `1px solid ${borderColor}40`, opacity: full ? 0.6 : 1 }} className="px-4 py-3.5 rounded-xl">
                          <div className="flex items-start gap-3">
                            <span className={`w-2 h-2 shrink-0 rounded-full mt-1.5 ${CAT_DOT[task.cat]}`} />
                            <div className="flex-1 min-w-0">
                              <span style={{ ...fontBody, color: full ? GREY_LABEL : CREAM, textDecoration: full ? "line-through" : "none" }} className="text-sm">{task.label}</span>
                              {task.note && <p style={{ ...fontMono, color: PERIWINKLE }} className="text-[11px] mt-1 italic">"{task.note}"</p>}
                              <div className="flex gap-1.5 mt-1.5 flex-wrap items-center">
                                <span style={{ ...fontMono, color: borderColor, border: `1px solid ${borderColor}50` }} className="text-[10px] px-2 py-0.5 rounded-full uppercase">
                                  {task.owner === "all" ? "All Artists" : USERS[task.owner as UserKey]?.label}
                                </span>
                                {owners.map(k => {
                                  const kd = !!c[k];
                                  return <span key={k} style={{ ...fontMono, color: kd ? ARTIST_COLOR[k] : `${GREY_LABEL}80` }} className="text-[10px]">{kd ? "✓" : "·"} {USERS[k].label}</span>;
                                })}
                                {task.reactions && Object.values(task.reactions).filter(Boolean).length > 0 && (
                                  <span className="text-[10px]">{Object.values(task.reactions).filter(Boolean).join(" ")}</span>
                                )}
                              </div>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <button onClick={() => setModal({ type:"editTask", task })} style={{ ...fontMono, color: GREY_LABEL }} className="text-[10px] px-2 py-1 uppercase hover:text-white">Edit</button>
                              <button onClick={() => deleteTask(task.id)} style={{ ...fontMono, color: RUST }} className="text-[10px] px-2 py-1 uppercase">✕</button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {month.days.filter(d => d.tasks.length === 0).length > 0 && (
              <div>
                <button onClick={() => setShowEmptyDays(v => !v)}
                  style={{ ...fontMono, color: GREY_LABEL, border: `1px solid ${GREY_LABEL}40` }}
                  className="text-[10px] px-3 py-1.5 rounded-md uppercase mb-3">
                  {showEmptyDays ? "Hide" : "Show"} {month.days.filter(d => d.tasks.length === 0).length} empty day{month.days.filter(d => d.tasks.length === 0).length !== 1 ? "s" : ""}
                </button>
                {showEmptyDays && (
                  <div className="space-y-3">
                    {month.days.filter(d => d.tasks.length === 0).map(day => (
                      <div key={day.id} className="flex items-center gap-3">
                        <span style={{ ...fontMono, color: `${GREY_LABEL}90` }} className="text-xs uppercase tracking-widest">{day.day}</span>
                        <div className="flex-1 h-px" style={{ backgroundColor: `${GREY_LABEL}20` }} />
                        <button onClick={() => setModal({ type:"addTask", dayId: day.id })}
                          style={{ ...fontMono, color: GREY_LABEL, border: `1px solid ${GREY_LABEL}40` }}
                          className="text-[10px] px-2 py-0.5 rounded-md uppercase">+ Task</button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl shadow-lg"
          style={{ backgroundColor: CREAM, color: NAVY_DEEP }}>
          <span style={{ ...fontBody }} className="text-sm font-medium">{toast}</span>
        </div>
      )}
    </div>
  );
}

function AuditLogModal({ audit, onClose }: { audit: AuditLog; onClose: () => void }) {
  return (
    <div className="fixed inset-0 flex items-center justify-center z-50 px-4 py-8" style={{ backgroundColor: "#000000B0" }}>
      <div className="rounded-2xl p-6 w-full max-w-md max-h-full overflow-y-auto" style={{ backgroundColor: NAVY_MID, border: `1px solid ${GREY_LABEL}40` }}>
        <div className="flex items-center justify-between mb-4">
          <h3 style={{ ...fontDisplay, color: CREAM }} className="text-lg font-semibold">Activity Log</h3>
          <button onClick={onClose} style={{ ...fontMono, color: GREY_LABEL }} className="text-xs uppercase">Close</button>
        </div>
        {audit.length === 0 ? (
          <p style={{ ...fontMono, color: GREY_LABEL }} className="text-xs">No activity yet.</p>
        ) : (
          <div className="space-y-3">
            {audit.map(entry => (
              <div key={entry.id} className="pb-3" style={{ borderBottom: `1px solid ${GREY_LABEL}20` }}>
                <p style={{ ...fontBody, color: CREAM }} className="text-xs">{entry.detail}</p>
                <p style={{ ...fontMono, color: GREY_LABEL }} className="text-[10px] mt-0.5">
                  {new Date(entry.ts).toLocaleString()} &middot; {entry.actor}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [currentUser, setCurrentUser]     = useState<UserKey | null>(null);
  const [schedule, setSchedule]           = useState<Schedule | null>(null);
  const [checks, setChecks]               = useState<Checks | null>(null);
  const [pins, setPins]                   = useState<Pins | null>(null);
  const [audit, setAudit]                 = useState<AuditLog>([]);
  const [loading, setLoading]             = useState(true);
  const [showChangePin, setShowChangePin] = useState(false);

  useEffect(() => {
    Promise.all([dbGetSchedule(), dbGetChecks(), dbGetPins(), dbGetAudit()]).then(([s, c, p, a]) => {
      setSchedule(s); setChecks(c); setPins(p); setAudit(a); setLoading(false);
    });
  }, []);

  useEffect(() => {
    const channel = supabase.channel("sintraa-sync")
      .on("postgres_changes", { event:"*", schema:"public", table:"schedule" }, payload => {
        const row = payload.new as any; if (row?.data) setSchedule(row.data as Schedule);
      })
      .on("postgres_changes", { event:"*", schema:"public", table:"checks" }, payload => {
        const row = payload.new as any; if (row?.data) setChecks(row.data as Checks);
      })
      .on("postgres_changes", { event:"*", schema:"public", table:"user_pins" }, () => {
        dbGetPins().then(setPins);
      })
      .on("postgres_changes", { event:"*", schema:"public", table:"audit_log" }, payload => {
        const row = payload.new as any; if (row?.data) setAudit(row.data as AuditLog);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const handleToggle = (task: Task, userKey: ArtistKey) => {
    setChecks(prev => {
      const base = prev || {};
      const taskChecks = { ...(base[task.id] || {}) };
      taskChecks[userKey] = !taskChecks[userKey];
      const next = { ...base, [task.id]: taskChecks };
      dbSetChecks(next);
      return next;
    });
    setAudit(prev => logAction(prev, USERS[userKey].label, "toggle", `${USERS[userKey].label} ${myCheckState(task, checks || {}, userKey) ? "unchecked" : "checked"} "${task.label}"`));
  };

  const handleReact = (task: Task, emoji: string) => {
    if (!currentUser || currentUser === "manager") return;
    const artistKey = currentUser as ArtistKey;
    setSchedule(prev => {
      if (!prev) return prev;
      const next = JSON.parse(JSON.stringify(prev)) as Schedule;
      for (const m of next) for (const d of m.days) for (const t of d.tasks) {
        if (t.id === task.id) {
          t.reactions = t.reactions || {};
          t.reactions[artistKey] = t.reactions[artistKey] === emoji ? undefined : emoji;
        }
      }
      dbSetSchedule(next);
      return next;
    });
  };

  const handleAddNote = (task: Task, note: string) => {
    setSchedule(prev => {
      if (!prev) return prev;
      const next = JSON.parse(JSON.stringify(prev)) as Schedule;
      for (const m of next) for (const d of m.days) for (const t of d.tasks) {
        if (t.id === task.id) t.note = note;
      }
      dbSetSchedule(next);
      return next;
    });
    setAudit(prev => logAction(prev, currentUser ? USERS[currentUser].label : "Someone", "note", `Note added to "${task.label}": "${note}"`));
  };

  const handleScheduleChange = (next: Schedule, detail?: string) => {
    setSchedule(next);
    dbSetSchedule(next);
    if (detail) setAudit(prev => logAction(prev, currentUser ? USERS[currentUser].label : "Manager", "edit", detail));
  };

  const handleChangePin = (newPin: string) => {
    if (!currentUser) return;
    dbSetPin(currentUser, newPin);
    setPins(prev => ({ ...(prev || DEFAULT_PINS), [currentUser]: newPin }));
    setShowChangePin(false);
  };

  if (loading || !pins) return <LoadingScreen />;
  if (!currentUser) return <LoginScreen pins={pins} onLogin={setCurrentUser} />;

  return (
    <>
      {showChangePin && <ChangePinModal onClose={() => setShowChangePin(false)} onSave={handleChangePin} />}
      {currentUser === "manager"
        ? <ManagerView schedule={schedule!} checks={checks!} audit={audit} onScheduleChange={handleScheduleChange} onLogout={() => setCurrentUser(null)} onChangePin={() => setShowChangePin(true)} />
        : <ArtistView userKey={currentUser as ArtistKey} schedule={schedule!} checks={checks!} onToggle={handleToggle} onLogout={() => setCurrentUser(null)} onChangePin={() => setShowChangePin(true)} onReact={handleReact} onAddNote={handleAddNote} />
      }
    </>
  );
}
