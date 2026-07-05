// Supabase Edge Function: daily-digest
// Runs every morning, checks each artist's tasks for today, sends a digest email via Resend.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const ARTIST_KEYS = ["dela", "muyii", "tycoon"] as const;
const USER_LABELS: Record<string, string> = { dela: "Dela", muyii: "Muyii", tycoon: "TYCOON", manager: "Manager" };

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function taskVisibleTo(task: any, userKey: string) {
  return task.owner === "all" || task.owner === userKey;
}

function myCheckState(task: any, checks: any, userKey: string) {
  return !!(checks[task.id] || {})[userKey];
}

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Sintraa Schedule <onboarding@resend.dev>",
      to: [to],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const errText = await res.text();
    console.error(`Failed to send to ${to}:`, errText);
  }
  return res.ok;
}

function buildEmailHTML(name: string, todayLabel: string, tasks: { label: string; cat: string }[]) {
  const catColor: Record<string, string> = { music: "#7E8AAD", content: "#B8C0D4", admin: "#B0453E" };
  const taskRows = tasks.length
    ? tasks.map(t => `
        <tr>
          <td style="padding: 10px 0; border-bottom: 1px solid #2A3450;">
            <span style="display:inline-block; width:8px; height:8px; border-radius:50%; background:${catColor[t.cat] || "#7E8AAD"}; margin-right:10px;"></span>
            <span style="color:#F7F5F1; font-family: Georgia, serif; font-size:14px;">${t.label}</span>
          </td>
        </tr>`).join("")
    : `<tr><td style="padding:10px 0; color:#5C5E6B; font-family: Georgia, serif; font-size:14px;">Nothing scheduled for you today. Enjoy the breather.</td></tr>`;

  return `
  <div style="background:#060D1C; padding:32px 24px; font-family: Georgia, serif;">
    <div style="max-width:480px; margin:0 auto;">
      <p style="color:#5C5E6B; font-size:11px; letter-spacing:2px; text-transform:uppercase; margin:0 0 8px;">Sintraa</p>
      <h1 style="color:#F7F5F1; font-size:24px; margin:0 0 4px;">Morning, ${name}.</h1>
      <p style="color:#7E8AAD; font-size:13px; margin:0 0 24px;">${todayLabel}</p>
      <table style="width:100%; border-collapse:collapse;">
        ${taskRows}
      </table>
      <p style="color:#5C5E6B; font-size:11px; margin-top:32px;">Open the app to check things off as you go.</p>
    </div>
  </div>`;
}

Deno.serve(async (_req) => {
  try {
    const { data: scheduleRow } = await supabase.from("schedule").select("data").eq("id", "main").single();
    const { data: checksRow }   = await supabase.from("checks").select("data").eq("id", "main").single();
    const { data: pinsRows }    = await supabase.from("user_pins").select("user_key, email");

    const schedule = scheduleRow?.data || [];
    const checks = checksRow?.data || {};
    const emails: Record<string, string> = {};
    for (const row of pinsRows || []) if (row.email) emails[row.user_key] = row.email;

    const today = todayISO();
    const allDays = schedule.flatMap((m: any) => m.days);
    const todayDay = allDays.find((d: any) => d.date === today);

    const results: string[] = [];

    for (const artistKey of ARTIST_KEYS) {
      const email = emails[artistKey];
      if (!email) { results.push(`${artistKey}: no email on file, skipped`); continue; }

      const tasks = todayDay
        ? todayDay.tasks
            .filter((t: any) => taskVisibleTo(t, artistKey) && !myCheckState(t, checks, artistKey))
            .map((t: any) => ({ label: t.label, cat: t.cat }))
        : [];

      const todayLabel = todayDay ? todayDay.day : "No schedule entry for today";
      const html = buildEmailHTML(USER_LABELS[artistKey], todayLabel, tasks);
      const ok = await sendEmail(email, `Sintraa — ${tasks.length} task${tasks.length !== 1 ? "s" : ""} today`, html);
      results.push(`${artistKey}: ${ok ? "sent" : "failed"} (${tasks.length} tasks)`);
    }

    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
