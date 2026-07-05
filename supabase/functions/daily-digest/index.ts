// Supabase Edge Function: daily-digest
// Runs every morning, checks each artist's tasks for today, sends a digest email via Brevo.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const BREVO_API_KEY = Deno.env.get("BREVO_API_KEY");

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const ARTIST_KEYS = ["dela", "muyii", "tycoon"];
const USER_LABELS = { dela: "Dela", muyii: "Muyii", tycoon: "TYCOON", manager: "Manager" };

function todayISO() {
  var d = new Date();
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, "0");
  var day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

function taskVisibleTo(task, userKey) {
  return task.owner === "all" || task.owner === userKey;
}

function myCheckState(task, checks, userKey) {
  var c = checks[task.id] || {};
  return !!c[userKey];
}

function sendEmail(to, toName, subject, html) {
  return fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_API_KEY,
      "Content-Type": "application/json",
      "Accept": "application/json"
    },
    body: JSON.stringify({
      sender: { name: "Sintraa Schedule", email: "sintraacentra@gmail.com" },
      to: [{ email: to, name: toName }],
      subject: subject,
      htmlContent: html
    })
  }).then(function (res) {
    if (!res.ok) {
      return res.text().then(function (errText) {
        console.error("Failed to send to " + to + ": " + errText);
        return false;
      });
    }
    return true;
  });
}

function buildEmailHTML(name, todayLabel, tasks) {
  var catColor = { music: "#7E8AAD", content: "#B8C0D4", admin: "#B0453E" };
  var taskRowsHtml = "";

  if (tasks.length === 0) {
    taskRowsHtml = "<tr><td style=\"padding:10px 0; color:#5C5E6B; font-family: Georgia, serif; font-size:14px;\">Nothing scheduled for you today. Enjoy the breather.</td></tr>";
  } else {
    for (var i = 0; i < tasks.length; i++) {
      var t = tasks[i];
      var dotColor = catColor[t.cat] || "#7E8AAD";
      taskRowsHtml += "<tr><td style=\"padding: 10px 0; border-bottom: 1px solid #2A3450;\">";
      taskRowsHtml += "<span style=\"display:inline-block; width:8px; height:8px; border-radius:50%; background:" + dotColor + "; margin-right:10px;\"></span>";
      taskRowsHtml += "<span style=\"color:#F7F5F1; font-family: Georgia, serif; font-size:14px;\">" + t.label + "</span>";
      taskRowsHtml += "</td></tr>";
    }
  }

  var html = "";
  html += "<div style=\"background:#060D1C; padding:32px 24px; font-family: Georgia, serif;\">";
  html += "<div style=\"max-width:480px; margin:0 auto;\">";
  html += "<p style=\"color:#5C5E6B; font-size:11px; letter-spacing:2px; text-transform:uppercase; margin:0 0 8px;\">Sintraa</p>";
  html += "<h1 style=\"color:#F7F5F1; font-size:24px; margin:0 0 4px;\">Morning, " + name + ".</h1>";
  html += "<p style=\"color:#7E8AAD; font-size:13px; margin:0 0 24px;\">" + todayLabel + "</p>";
  html += "<table style=\"width:100%; border-collapse:collapse;\">";
  html += taskRowsHtml;
  html += "</table>";
  html += "<p style=\"color:#5C5E6B; font-size:11px; margin-top:32px;\">Open the app to check things off as you go.</p>";
  html += "</div>";
  html += "</div>";

  return html;
}

Deno.serve(async function (_req) {
  try {
    var scheduleResult = await supabase.from("schedule").select("data").eq("id", "main").single();
    var checksResult = await supabase.from("checks").select("data").eq("id", "main").single();
    var pinsResult = await supabase.from("user_pins").select("user_key, email");

    var schedule = (scheduleResult.data && scheduleResult.data.data) || [];
    var checks = (checksResult.data && checksResult.data.data) || {};
    var pinsRows = pinsResult.data || [];

    var emails = {};
    for (var i = 0; i < pinsRows.length; i++) {
      var row = pinsRows[i];
      if (row.email) emails[row.user_key] = row.email;
    }

    var today = todayISO();
    var allDays = [];
    for (var m = 0; m < schedule.length; m++) {
      allDays = allDays.concat(schedule[m].days);
    }
    var todayDay = null;
    for (var d = 0; d < allDays.length; d++) {
      if (allDays[d].date === today) { todayDay = allDays[d]; break; }
    }

    var results = [];

    for (var a = 0; a < ARTIST_KEYS.length; a++) {
      var artistKey = ARTIST_KEYS[a];
      var email = emails[artistKey];
      if (!email) {
        results.push(artistKey + ": no email on file, skipped");
        continue;
      }

      var tasks = [];
      if (todayDay) {
        for (var ti = 0; ti < todayDay.tasks.length; ti++) {
          var task = todayDay.tasks[ti];
          if (taskVisibleTo(task, artistKey) && !myCheckState(task, checks, artistKey)) {
            tasks.push({ label: task.label, cat: task.cat });
          }
        }
      }

      var todayLabel = todayDay ? todayDay.day : "No schedule entry for today";
      var html = buildEmailHTML(USER_LABELS[artistKey], todayLabel, tasks);
      var subject = "Sintraa - " + tasks.length + " task" + (tasks.length !== 1 ? "s" : "") + " today";
      var ok = await sendEmail(email, USER_LABELS[artistKey], subject, html);
      results.push(artistKey + ": " + (ok ? "sent" : "failed") + " (" + tasks.length + " tasks)");
    }

    return new Response(JSON.stringify({ ok: true, results: results }), {
      headers: { "Content-Type": "application/json" }
    });
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
});
