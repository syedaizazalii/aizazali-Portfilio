// ==========================================
// PROFESSIONAL ADMIN DASHBOARD
// ==========================================

// Change this to match the Supabase Storage bucket you use for
// portfolio media (project images, certificates, avatars, etc).
const STORAGE_BUCKET = "portfolio-media";

let currentTab = "dashboard";
let profileRowId = null;
let modalMode = null;   // "add" | "edit"
let modalTable = null;
let modalRowId = null;

// UTIL
function esc(str) {
  if (str === null || str === undefined) return "";
  const div = document.createElement("div");
  div.textContent = String(str);
  return div.innerHTML;
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  return new Date(dateStr).toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

// Only allow safe, clickable URL schemes (http/https/mailto). Blocks
// javascript: and other schemes from being placed into href attributes.
function sanitizeUrl(url) {
  if (!url) return "";
  const trimmed = String(url).trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  if (/^\/|^\.\.?\//.test(trimmed)) return trimmed; // relative paths
  return "";
}

// Basic debounce helper — delays calling fn until `wait` ms after the
// last call, so fast typing (search boxes) doesn't re-render on every key.
function debounce(fn, wait = 300) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
}

// Builds a Gmail web compose link so Reply always opens Gmail in a new tab
// instead of triggering the OS's default mail app (e.g. Outlook) via mailto:.
function buildGmailComposeUrl(email, subject, body) {
  const params = new URLSearchParams({ view: "cm", fs: "1", to: email || "" });
  if (subject) params.set("su", subject);
  if (body) params.set("body", body);
  return `https://mail.google.com/mail/?${params.toString()}`;
}

// Animated shimmer placeholder shown while data loads
function renderSkeleton(count = 5) {
  return `<div class="skeleton-wrap">${Array.from({ length: count }).map(() => `<div class="skeleton-row"></div>`).join("")}</div>`;
}

// ==========================================
// TOAST + CUSTOM CONFIRM (replaces browser alert/confirm)
// ==========================================
function showToast(message, type = "success") {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = "toast" + (type === "error" ? " error" : "");
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function showConfirm(message, confirmLabel = "Delete") {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    overlay.style.display = "flex";
    overlay.innerHTML = `
      <div class="modal-box" style="max-width:380px;">
        <p class="confirm-message">${esc(message)}</p>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" id="confirmCancelBtn">Cancel</button>
          <button type="button" class="btn-danger-solid" id="confirmOkBtn">${esc(confirmLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    const cleanup = (result) => { overlay.remove(); resolve(result); };
    overlay.addEventListener("click", (e) => { if (e.target === overlay) cleanup(false); });
    overlay.querySelector("#confirmCancelBtn").addEventListener("click", () => cleanup(false));
    overlay.querySelector("#confirmOkBtn").addEventListener("click", () => cleanup(true));
  });
}

// Fire-and-forget activity logging — never blocks or breaks the calling action
async function logActivity(action, tableName, description) {
  try {
    await supabaseClient.from("activity_log").insert([{ action, table_name: tableName, description }]);
  } catch (e) { /* silent — activity_log table may not exist yet */ }
}

function exportToCSV(data, filename) {
  if (!data || data.length === 0) { showToast("Nothing to export.", "error"); return; }
  const keys = Array.from(new Set(data.flatMap(row => Object.keys(row))));
  const escapeCSV = (val) => {
    if (val === null || val === undefined) return "";
    const str = Array.isArray(val) ? val.join("; ") : String(val);
    return /[",\n]/.test(str) ? '"' + str.replace(/"/g, '""') + '"' : str;
  };
  const rows = [keys.join(","), ...data.map(row => keys.map(k => escapeCSV(row[k])).join(","))];
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  showToast("Exported " + filename);
}

function renderSkeleton(rows = 5) {
  return `<div class="skeleton-wrap">${Array.from({ length: rows }).map(() => `<div class="skeleton-row"></div>`).join("")}</div>`;
}

function toDateInputValue(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

// ==========================================
// AUTH
// ==========================================
const loginScreen = document.getElementById("loginScreen");
const adminApp = document.getElementById("adminApp");

async function checkSession() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    loginScreen.style.display = "none";
    adminApp.style.display = "grid";
    document.getElementById("userEmail").textContent = session.user.email;
    renderTab("dashboard");
    refreshNotifications();
  } else {
    loginScreen.style.display = "flex";
    adminApp.style.display = "none";
  }
}

// ==========================================
// LOGIN RATE LIMITING
// Locks out login attempts with growing cooldowns after repeated failures,
// to slow down brute-force / credential-stuffing attempts against this page.
// ==========================================
const LOGIN_LOCK_KEY = "admin_login_lock";
const MAX_LOGIN_ATTEMPTS = 5;

function getLoginLockState() {
  try {
    return JSON.parse(localStorage.getItem(LOGIN_LOCK_KEY)) || { attempts: 0, lockedUntil: 0 };
  } catch { return { attempts: 0, lockedUntil: 0 }; }
}
function setLoginLockState(state) {
  try { localStorage.setItem(LOGIN_LOCK_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
}
function recordFailedLogin() {
  const state = getLoginLockState();
  state.attempts = (state.attempts || 0) + 1;
  if (state.attempts >= MAX_LOGIN_ATTEMPTS) {
    // Exponential-ish backoff: 30s, 60s, 120s... capped at 10 minutes.
    const extraLockouts = state.attempts - MAX_LOGIN_ATTEMPTS;
    const seconds = Math.min(30 * Math.pow(2, extraLockouts), 600);
    state.lockedUntil = Date.now() + seconds * 1000;
  }
  setLoginLockState(state);
  return state;
}
function clearLoginLock() { setLoginLockState({ attempts: 0, lockedUntil: 0 }); }

function remainingLockSeconds() {
  const state = getLoginLockState();
  return Math.max(0, Math.ceil((state.lockedUntil - Date.now()) / 1000));
}

document.getElementById("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = document.getElementById("loginEmail").value.trim();
  const password = document.getElementById("loginPassword").value;
  const statusEl = document.getElementById("loginStatus");
  const submitBtn = e.target.querySelector(".btn-login");

  const waitSecs = remainingLockSeconds();
  if (waitSecs > 0) {
    statusEl.textContent = `Too many attempts. Try again in ${waitSecs}s.`;
    return;
  }

  statusEl.textContent = "Logging in…";
  if (submitBtn) submitBtn.disabled = true;

  const { error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    const state = recordFailedLogin();
    const left = remainingLockSeconds();
    statusEl.textContent = left > 0
      ? `Too many failed attempts. Try again in ${left}s.`
      : `Invalid email or password. (${MAX_LOGIN_ATTEMPTS - state.attempts} attempt(s) left before a cooldown.)`;
    if (submitBtn) submitBtn.disabled = false;
    return;
  }
  clearLoginLock();
  statusEl.textContent = "";
  if (submitBtn) submitBtn.disabled = false;
  checkSession();
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await supabaseClient.auth.signOut();
  checkSession();
});

document.getElementById("forgotPasswordLink").addEventListener("click", async (e) => {
  e.preventDefault();
  const statusEl = document.getElementById("loginStatus");
  const email = document.getElementById("loginEmail").value.trim();
  if (!email) {
    statusEl.textContent = "Enter your email above first, then click Forgot password.";
    return;
  }
  statusEl.textContent = "Sending reset email…";
  const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin + window.location.pathname,
  });
  statusEl.textContent = error ? "Error: " + error.message : "Reset email sent — check your inbox.";
});

// ==========================================
// NAV
// ==========================================
document.querySelectorAll(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    currentTab = btn.dataset.tab;
    renderTab(currentTab);
  });
});

// ==========================================
// NOTIFICATIONS — bell icon with unread contact-message alerts.
// Clicking a notification marks it "seen" (is_read = true) and jumps
// to the Messages tab; "Mark all seen" clears the whole badge at once.
// ==========================================
async function refreshNotifications() {
  const { data, error } = await supabaseClient
    .from("contact_messages")
    .select("id, name, email, subject, message, created_at, is_read")
    .eq("is_read", false)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) return; // table may not exist yet — fail silently
  renderNotifDropdown(data || []);
  updateNotifBadge((data || []).length);
}

function updateNotifBadge(count) {
  const badge = document.getElementById("notifBadge");
  if (!badge) return;
  if (count > 0) {
    badge.textContent = count > 99 ? "99+" : String(count);
    badge.style.display = "flex";
  } else {
    badge.style.display = "none";
  }
}

function renderNotifDropdown(items) {
  const list = document.getElementById("notifList");
  if (!list) return;

  if (items.length === 0) {
    list.innerHTML = `<p class="notif-empty">You're all caught up.</p>`;
    return;
  }

  list.innerHTML = items.map(m => `
    <div class="notif-item" data-id="${esc(m.id)}">
      <span class="notif-item-dot"></span>
      <div class="notif-item-body">
        <span class="notif-item-title">${esc(m.name || "Someone")}${m.subject ? " — " + esc(m.subject) : ""}</span>
        <span class="notif-item-preview">${esc((m.message || "").slice(0, 70))}${(m.message || "").length > 70 ? "…" : ""}</span>
        <span class="notif-item-time">${esc(timeAgo(m.created_at))}</span>
      </div>
    </div>`).join("");

  list.querySelectorAll(".notif-item").forEach(el => {
    el.addEventListener("click", async () => {
      const id = el.dataset.id;
      await supabaseClient.from("contact_messages").update({ is_read: true }).eq("id", id);
      document.getElementById("notifDropdown").style.display = "none";
      document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
      const navBtn = document.querySelector('.nav-item[data-tab="contact_messages"]');
      if (navBtn) navBtn.classList.add("active");
      currentTab = "contact_messages";
      await renderTab("contact_messages");
      refreshNotifications();
      showToast("Marked as seen.");
    });
  });
}

const notifBellBtn = document.getElementById("notifBell");
if (notifBellBtn) {
  notifBellBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const dd = document.getElementById("notifDropdown");
    if (dd) dd.style.display = dd.style.display === "none" ? "block" : "none";
  });
}

document.addEventListener("click", (e) => {
  const wrap = document.getElementById("notifWrap");
  const dd = document.getElementById("notifDropdown");
  if (wrap && dd && dd.style.display !== "none" && !wrap.contains(e.target)) {
    dd.style.display = "none";
  }
});

const notifMarkAllBtn = document.getElementById("notifMarkAll");
if (notifMarkAllBtn) {
  notifMarkAllBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const { error } = await supabaseClient.from("contact_messages").update({ is_read: true }).eq("is_read", false);
    if (error) { showToast("Error: " + error.message, "error"); return; }
    showToast("All messages marked as seen.");
    refreshNotifications();
    if (currentTab === "contact_messages") renderTab("contact_messages");
  });
}

// Poll for new messages every 60s while logged in.
setInterval(() => {
  if (adminApp.style.display !== "none") refreshNotifications();
}, 60000);

// ==========================================
// DASHBOARD OVERVIEW
// ==========================================
async function renderDashboard() {
  const pageTitle = document.getElementById("pageTitle");
  pageTitle.textContent = "Dashboard";
  document.getElementById("tabContent").innerHTML = renderSkeleton(7);

  const [projectsRes, skillsRes, experienceRes, educationRes, certificationsRes, testimonialRes, messagesRes, unreadRes] = await Promise.all([
    supabaseClient.from("projects").select("id"),
    supabaseClient.from("skill_categories").select("id"),
    supabaseClient.from("experience").select("id"),
    supabaseClient.from("education").select("id"),
    supabaseClient.from("certifications").select("id"),
    supabaseClient.from("testimonials").select("id"),
    supabaseClient.from("contact_messages").select("id", { count: "exact" }),
    supabaseClient.from("contact_messages").select("id", { count: "exact" }).eq("is_read", false),
  ]);

  const rows = [
    { label: "Projects", tab: "projects", value: projectsRes.data?.length },
    { label: "Skill Categories", tab: "skill_categories", value: skillsRes.data?.length },
    { label: "Education", tab: "education", value: educationRes.data?.length },
    { label: "Experience", tab: "experience", value: experienceRes.data?.length },
    { label: "Certifications", tab: "certifications", value: certificationsRes.data?.length },
    { label: "Testimonials", tab: "testimonials", value: testimonialRes.data?.length },
    { label: "Contact Messages", tab: "contact_messages", value: messagesRes.count, unread: unreadRes.count },
  ];

  document.getElementById("tabContent").innerHTML = `
    <p class="dash-subtitle">Quick overview of your content.</p>
    <div class="dash-list">
      ${rows.map((r, i) => `
        <div class="dash-row" data-tab="${r.tab}" style="animation-delay:${i * 60}ms">
          <span class="dash-label">${esc(r.label)}${r.unread ? ` <span class="msg-unread-dot"></span><span style="color:var(--accent);font-size:0.78rem;font-family:var(--font-mono);">${r.unread} new</span>` : ""}</span>
          <span class="dash-count">${r.value ?? "—"} rows</span>
        </div>
      `).join("")}
    </div>
  `;

  document.getElementById("tabContent").querySelectorAll(".dash-row").forEach(row => {
    row.addEventListener("click", () => {
      const tab = row.dataset.tab;
      document.querySelectorAll(".nav-item").forEach(b => b.classList.remove("active"));
      const navBtn = document.querySelector(`.nav-item[data-tab="${tab}"]`);
      if (navBtn) navBtn.classList.add("active");
      currentTab = tab;
      renderTab(tab);
    });
  });
}

// ==========================================
// SMALL HELPERS used elsewhere (e.g. the notification bell)
// ==========================================
function timeAgo(dateStr) {
  if (!dateStr) return "";
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + "m ago";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return hours + "h ago";
  const days = Math.floor(hours / 24);
  if (days < 30) return days + "d ago";
  return formatDate(dateStr);
}

// ==========================================
// FIELD SCHEMAS — define how Add/Edit forms render per table
// Types: text | textarea | url | date | number | checkbox | file
// ==========================================
const FIELD_SCHEMAS = {
  projects: [
    { name: "title", label: "Project Title", type: "text", required: true },
    { name: "description", label: "Description", type: "textarea" },
    { name: "tech_stack", label: "Tech Stack (comma separated)", type: "array" },
    { name: "image_url", label: "Project Image", type: "file" },
    { name: "project_link", label: "Live Project URL", type: "url" },
    { name: "github_link", label: "GitHub / Source URL", type: "url" },
    { name: "featured", label: "Featured Project", type: "checkbox" },
    { name: "sort_order", label: "Display Order", type: "number" },
    { name: "is_visible", label: "Visible on site", type: "checkbox", default: true },
  ],
  skill_categories: [
    { name: "name", label: "Category Name", type: "text", required: true },
    { name: "proficiency", label: "Proficiency % (0-100)", type: "number", min: 1, max: 100 },
    { name: "skills_list", label: "Skills (comma separated)", type: "textarea" },
    { name: "sort_order", label: "Display Order", type: "number" },
  ],
  experience: [
    { name: "company", label: "Company / Organization", type: "text", required: true },
    { name: "role", label: "Position", type: "text" },
    { name: "employment_type", label: "Employment Type", type: "text" },
    { name: "start_date", label: "Start Date", type: "date" },
    { name: "end_date", label: "End Date", type: "date" },
    { name: "is_current", label: "Current Position", type: "checkbox" },
    { name: "description", label: "Description / Responsibilities", type: "textarea" },
    { name: "technologies", label: "Technologies used (comma separated)", type: "array" },
    { name: "icon_url", label: "Icon (Image URL)", type: "file" },
    { name: "sort_order", label: "Display Order", type: "number" },
    { name: "is_visible", label: "Visible on site", type: "checkbox", default: true },
  ],
  education: [
    { name: "institution", label: "Institution", type: "text", required: true },
    { name: "degree", label: "Degree / Qualification", type: "text" },
    { name: "field_of_study", label: "Field of Study", type: "text" },
    { name: "start_date", label: "Start Date", type: "date" },
    { name: "end_date", label: "End Date", type: "date" },
    { name: "description", label: "Description", type: "textarea" },
    { name: "grade", label: "Grade (optional)", type: "text" },
    { name: "icon_url", label: "Icon (Image URL)", type: "file" },
    { name: "sort_order", label: "Display Order", type: "number" },
    { name: "is_visible", label: "Visible on site", type: "checkbox", default: true },
  ],
  certifications: [
    { name: "title", label: "Certification Title", type: "text", required: true },
    { name: "issued_by", label: "Issuing Organization", type: "text" },
    { name: "issue_date", label: "Issue Date", type: "date" },
    { name: "expiry_date", label: "Expiry Date (optional)", type: "date" },
    { name: "credential_id", label: "Credential ID", type: "text" },
    { name: "credential_url", label: "Verification URL", type: "url" },
    { name: "image_url", label: "Certificate Image", type: "file" },
    { name: "sort_order", label: "Display Order", type: "number" },
    { name: "is_visible", label: "Visible on site", type: "checkbox", default: true },
  ],
  testimonials: [
    { name: "name", label: "Person's Name", type: "text", required: true },
    { name: "designation", label: "Position", type: "text" },
    { name: "company", label: "Company", type: "text" },
    { name: "image_url", label: "Photo", type: "file" },
    { name: "message", label: "Review", type: "textarea" },
    { name: "rating", label: "Rating (1-5)", type: "number", min: 1, max: 5 },
    { name: "sort_order", label: "Display Order", type: "number" },
    { name: "is_visible", label: "Visible on site", type: "checkbox", default: true },
  ],
  social_links: [
    { name: "platform", label: "Platform Name (e.g. Email, LinkedIn, GitHub)", type: "text", required: true },
    { name: "url", label: "URL or Email Address", type: "text", required: true },
    { name: "icon_url", label: "Icon URL (optional, PNG/SVG link — leave blank for default icon)", type: "url" },
    { name: "sort_order", label: "Display Order", type: "number" },
    { name: "is_visible", label: "Visible on site", type: "checkbox", default: true },
  ],
  settings: [
    { name: "key", label: "Key", type: "text", required: true },
    { name: "value", label: "Value (plain text or JSON)", type: "textarea" },
  ],
};

// Fallback schema builder for editing rows in tables without a defined
// schema above — infers a reasonable input type from the field name/value.
function inferSchemaFromRow(row) {
  return Object.keys(row)
    .filter(k => !["id", "created_at", "updated_at"].includes(k))
    .map(name => {
      const val = row[name];
      let type = "text";
      if (/description|bio|paragraphs|message|content|notes/i.test(name)) type = "textarea";
      else if (/date/i.test(name)) type = "date";
      else if (/url|link|website/i.test(name)) type = "url";
      else if (/photo|image|avatar|file/i.test(name)) type = "file";
      else if (typeof val === "boolean") type = "checkbox";
      else if (typeof val === "number") type = "number";
      return { name, label: name.replace(/_/g, " "), type };
    });
}

// ==========================================
// ANALYTICS TAB — simple overview built entirely from your own Supabase
// data (content counts, messages, activity log). No external setup needed.
// ==========================================
function computeTrend(current, previous) {
  if (!previous) return { pct: current > 0 ? 100 : 0, up: true };
  const pct = ((current - previous) / previous) * 100;
  return { pct: Math.round(Math.abs(pct)), up: pct >= 0 };
}

// Simple area+line chart from an array of numeric values.
function buildAreaChartSVG(values, labels, color) {
  const w = 640, h = 180, padX = 12, bottomPad = 26, topPad = 14;
  const max = Math.max(1, ...values);
  const stepX = values.length > 1 ? (w - padX * 2) / (values.length - 1) : 0;
  const points = values.map((v, i) => {
    const x = padX + i * stepX;
    const y = h - bottomPad - (v / max) * (h - bottomPad - topPad);
    return [x, y];
  });
  const linePath = points.map((p, i) => (i === 0 ? "M" : "L") + p[0].toFixed(1) + "," + p[1].toFixed(1)).join(" ");
  const areaPath = `${linePath} L ${points[points.length - 1][0].toFixed(1)},${h - bottomPad} L ${points[0][0].toFixed(1)},${h - bottomPad} Z`;
  const gradId = "areaGrad" + Math.random().toString(36).slice(2, 8);
  const dots = points.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" fill="${color}"><title>${esc(labels[i])}: ${values[i]}</title></circle>`).join("");
  const showEvery = Math.max(1, Math.ceil(values.length / 7));
  const xLabels = points.map((p, i) => (i % showEvery === 0 || i === points.length - 1)
    ? `<text x="${p[0].toFixed(1)}" y="${h - 8}" font-size="9" fill="var(--text-faint)" text-anchor="middle" font-family="var(--font-mono)">${esc(labels[i])}</text>`
    : "").join("");
  return `<svg viewBox="0 0 ${w} ${h}" class="chart-svg">
    <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.35"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0"/>
    </linearGradient></defs>
    <path d="${areaPath}" fill="url(#${gradId})" stroke="none"/>
    <path d="${linePath}" fill="none" stroke="${color}" stroke-width="2"/>
    ${dots}
    ${xLabels}
  </svg>`;
}

// Simple donut chart from [{label, value, color}] segments.
function buildDonutSVG(segments, size = 140, strokeWidth = 18) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  const r = (size - strokeWidth) / 2;
  const cx = size / 2, cy = size / 2;
  const circumference = 2 * Math.PI * r;
  let cumulative = 0;
  const arcs = total === 0 ? "" : segments.map(seg => {
    const frac = seg.value / total;
    const dash = frac * circumference;
    const gap = circumference - dash;
    const rotation = (cumulative / total) * 360 - 90;
    cumulative += seg.value;
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${seg.color}" stroke-width="${strokeWidth}" stroke-dasharray="${dash.toFixed(1)} ${gap.toFixed(1)}" transform="rotate(${rotation.toFixed(1)} ${cx} ${cy})"><title>${esc(seg.label)}: ${seg.value}</title></circle>`;
  }).join("");
  return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${strokeWidth}"/>
    ${arcs}
    <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-family="var(--font-display)" font-size="22" font-weight="600" fill="var(--text)">${total}</text>
    <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-family="var(--font-mono)" font-size="9" fill="var(--text-muted)">total</text>
  </svg>`;
}

async function renderAnalyticsTab() {
  const pageTitle = document.getElementById("pageTitle");
  pageTitle.textContent = "Analytics";
  const content = document.getElementById("tabContent");
  content.innerHTML = renderSkeleton();

  const now = new Date();
  const since7 = new Date(now); since7.setDate(now.getDate() - 7);
  const since14 = new Date(now); since14.setDate(now.getDate() - 14);

  const tableNames = ["projects", "skill_categories", "experience", "education", "certifications", "testimonials", "social_links"];
  const tableLabels = { projects: "Projects", skill_categories: "Skills", experience: "Experience", education: "Education", certifications: "Certifications", testimonials: "Testimonials", social_links: "Social Links" };

  const [countsRes, activityRes, messagesRes] = await Promise.all([
    Promise.all(tableNames.map(t => supabaseClient.from(t).select("id"))),
    supabaseClient.from("activity_log").select("id, action, table_name, description, created_at").order("created_at", { ascending: false }).limit(300),
    supabaseClient.from("contact_messages").select("id, created_at, is_read"),
  ]);

  const contentBreakdown = tableNames.map((t, i) => ({ label: tableLabels[t], value: countsRes[i].data?.length || 0 }));
  const totalContent = contentBreakdown.reduce((s, c) => s + c.value, 0);

  const activity = activityRes.data || [];
  const messages = messagesRes.data || [];

  const dayBuckets = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(now); d.setDate(now.getDate() - i); d.setHours(0, 0, 0, 0);
    dayBuckets.push({ date: d, label: d.toLocaleDateString("en-US", { day: "numeric", month: "short" }), count: 0 });
  }
  activity.forEach(a => {
    const d = new Date(a.created_at);
    const idx = dayBuckets.findIndex(b => d >= b.date && d.getTime() < b.date.getTime() + 86400000);
    if (idx !== -1) dayBuckets[idx].count++;
  });

  const activityLast7 = activity.filter(a => new Date(a.created_at) >= since7).length;
  const activityPrev7 = activity.filter(a => { const d = new Date(a.created_at); return d >= since14 && d < since7; }).length;
  const activityTrend = computeTrend(activityLast7, activityPrev7);

  const unreadCount = messages.filter(m => m.is_read === false).length;
  const readCount = messages.length - unreadCount;

  const lineChart = buildAreaChartSVG(dayBuckets.map(b => b.count), dayBuckets.map(b => b.label), "#e6394f");
  const donutChart = buildDonutSVG([
    { label: "Unread", value: unreadCount, color: "#e6394f" },
    { label: "Read", value: readCount, color: "#4f8dff" },
  ]);

  const maxBreakdown = Math.max(1, ...contentBreakdown.map(c => c.value));
  const barListHtml = [...contentBreakdown].sort((a, b) => b.value - a.value).map(c => `
    <div class="analytics-bar-row">
      <span class="analytics-bar-label">${esc(c.label)}</span>
      <div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:${(c.value / maxBreakdown * 100).toFixed(1)}%"></div></div>
      <span class="analytics-bar-value">${c.value}</span>
    </div>`).join("");

  const recentActivity = activity.slice(0, 8).map(a => `
    <div class="activity-feed-row">
      <span class="activity-feed-dot"></span>
      <div class="activity-feed-body">
        <span class="activity-feed-text"><strong>${esc(a.action || "")}</strong>${a.table_name ? " in " + esc(tableLabels[a.table_name] || a.table_name) : ""}${a.description ? " — " + esc(a.description) : ""}</span>
        <span class="activity-feed-time">${esc(timeAgo(a.created_at))}</span>
      </div>
    </div>`).join("") || `<p style="color:var(--text-muted);text-align:center;padding:1.5rem;">No activity recorded yet.</p>`;

  content.innerHTML = `
    <p class="dash-subtitle">A simple overview of your content and messages — built from your own data.</p>

    <div class="analytics-stats-grid">
      <div class="analytics-stat-card">
        <span class="analytics-stat-label">Total Content Items</span>
        <span class="analytics-stat-value">${totalContent}</span>
      </div>
      <div class="analytics-stat-card">
        <span class="analytics-stat-label">Total Messages</span>
        <span class="analytics-stat-value">${messages.length}</span>
      </div>
      <div class="analytics-stat-card">
        <span class="analytics-stat-label">Unread Messages</span>
        <span class="analytics-stat-value">${unreadCount}</span>
      </div>
      <div class="analytics-stat-card">
        <span class="analytics-stat-label">Activity (7d)</span>
        <span class="analytics-stat-value">${activityLast7}</span>
        <span class="analytics-trend ${activityTrend.up ? "trend-up" : "trend-down"}">${activityTrend.up ? "▲" : "▼"} ${activityTrend.pct}% vs prior 7d</span>
      </div>
    </div>

    <div class="analytics-grid">
      <div class="analytics-panel analytics-panel-wide">
        <h3 class="analytics-panel-title">Activity — last 14 days</h3>
        <div class="chart-wrap">${lineChart}</div>
      </div>
      <div class="analytics-panel">
        <h3 class="analytics-panel-title">Messages read vs unread</h3>
        <div class="donut-wrap">
          ${donutChart}
          <div class="donut-legend">
            <span><i style="background:#e6394f"></i> Unread (${unreadCount})</span>
            <span><i style="background:#4f8dff"></i> Read (${readCount})</span>
          </div>
        </div>
      </div>
    </div>

    <div class="analytics-grid">
      <div class="analytics-panel">
        <h3 class="analytics-panel-title">Content breakdown</h3>
        <div class="analytics-bar-list">${barListHtml}</div>
      </div>
      <div class="analytics-panel">
        <h3 class="analytics-panel-title">Recent activity</h3>
        <div class="activity-feed">${recentActivity}</div>
      </div>
    </div>
  `;
}


async function getSetting(key) {
  const { data } = await supabaseClient.from("settings").select("value").eq("key", key).maybeSingle();
  return data?.value || null;
}

async function upsertSetting(key, value) {
  const { data: existing } = await supabaseClient.from("settings").select("id").eq("key", key).maybeSingle();
  if (existing) {
    return supabaseClient.from("settings").update({ value }).eq("id", existing.id);
  }
  return supabaseClient.from("settings").insert({ key, value });
}

function clamp(val, min, max) {
  return Math.min(Math.max(val, min), max);
}

async function renderSettingsTab() {
  const pageTitle = document.getElementById("pageTitle");
  pageTitle.textContent = "Settings";
  const content = document.getElementById("tabContent");
  content.innerHTML = renderSkeleton();

  const [{ data, error }, currentFavicon, currentAccent, currentFooterNote, sectionsRes] = await Promise.all([
    supabaseClient.from("settings").select("*").order("key", { ascending: true }),
    getSetting("favicon_url"),
    getSetting("theme_accent_color"),
    getSetting("footer_note"),
    supabaseClient.from("page_sections").select("*").order("sort_order", { ascending: true }),
  ]);

  if (error) {
    content.innerHTML = `<p style="color:var(--accent);">Error loading data: ${esc(error.message)}</p>`;
    return;
  }

  const sectionsData = sectionsRes.error ? null : (sectionsRes.data || []);

  content.innerHTML = `
    <div class="favicon-card">
      <h3>Site Icon (Favicon)</h3>
      <p class="favicon-hint">This is the small icon shown in the browser tab and bookmarks. Upload and
      crop a new one any time — it updates on the live site automatically, no code changes needed.</p>
      <div class="favicon-row">
        <div class="favicon-current">
          <span class="favicon-current-label">Current</span>
          <img id="faviconCurrentPreview" src="${esc(currentFavicon || "../favicon.ico")}" alt="Current favicon" onerror="this.style.opacity=0.3" />
        </div>

        <div class="favicon-crop-area" id="faviconCropArea" style="display:none;">
          <div class="favicon-crop-frame" id="faviconCropFrame">
            <img id="faviconCropImg" draggable="false" alt="" />
          </div>
          <input type="range" id="faviconZoom" min="1" max="3" step="0.01" value="1" />
          <div class="favicon-crop-actions">
            <button type="button" class="btn-primary" id="faviconSaveBtn" style="width:auto;">Save Icon</button>
            <button type="button" class="btn-secondary" id="faviconCancelBtn" style="width:auto;">Cancel</button>
          </div>
        </div>

        <div class="favicon-upload-actions" id="faviconUploadActions">
          <input type="file" id="faviconFileInput" accept="image/*" style="display:none;" />
          <button type="button" class="btn-secondary" id="faviconChooseBtn" style="width:auto;">Change Icon</button>
          <p class="favicon-sub-hint">Drag to reposition, use the slider to zoom, once a photo is chosen.</p>
        </div>
      </div>
      <p class="form-status" id="faviconStatus"></p>
    </div>

    <div class="favicon-card">
      <h3>Site Appearance</h3>
      <p class="favicon-hint">The accent color used for buttons, highlights, and skill bars — plus the small
      note shown at the very bottom of the footer.</p>
      <div class="appearance-row">
        <div class="appearance-field">
          <label class="appearance-label">Accent color</label>
          <div class="appearance-color-row">
            <input type="color" id="accentColorInput" value="${esc(currentAccent || "#F5B843")}" />
            <span class="appearance-color-hex" id="accentColorHex">${esc(currentAccent || "#F5B843")}</span>
          </div>
        </div>
        <div class="appearance-field appearance-field-wide">
          <label class="appearance-label">Footer note</label>
          <input type="text" id="footerNoteInput" value="${esc(currentFooterNote || "Built with intent, not a template.")}" maxlength="120" />
        </div>
      </div>
      <button type="button" class="btn-primary" id="appearanceSaveBtn" style="width:auto;margin-top:1rem;">Save Appearance</button>
      <p class="form-status" id="appearanceStatus"></p>
    </div>

    <div class="favicon-card">
      <h3>Page Sections</h3>
      <p class="favicon-hint">Turn sections on or off, and drag to change the order they appear in on the
      portfolio (Home always stays first).</p>
      ${sectionsData === null
        ? `<p class="favicon-hint" style="color:var(--accent);">This feature needs a one-time database setup — see the note below the Settings page for the SQL to run in Supabase.</p>`
        : `<div id="pageSectionsList" class="page-sections-list"></div>
           <p class="form-status" id="pageSectionsStatus"></p>`
      }
    </div>

    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
      <h2>Other Settings (${data.length})</h2>
      <div style="display:flex;gap:0.6rem;">
        <button class="btn-secondary" id="exportBtn" style="width:auto;">Export CSV</button>
        <button class="btn-primary" id="addBtn">+ Add New</button>
      </div>
    </div>
    <div class="bulk-bar" id="bulkBar" style="display:none;">
      <button class="btn-action danger" id="bulkDeleteBtn">Delete selected (<span id="bulkCount">0</span>)</button>
      <button class="btn-secondary" id="bulkClearBtn" style="width:auto;">Clear selection</button>
    </div>
    <div id="tableWrap" style="overflow-x:auto;"></div>
  `;

  const config = TABLES.settings;
  document.getElementById("exportBtn").addEventListener("click", () => exportToCSV(data, "settings.csv"));
  document.getElementById("addBtn").addEventListener("click", () => openAddModal("settings"));
  renderTableData("settings", data, config);

  const searchBox = document.getElementById("searchBox");
  searchBox.style.display = "inline-block";
  searchBox.value = "";
  searchBox.placeholder = "Search settings...";
  searchBox.oninput = debounce(() => {
    const term = searchBox.value.trim().toLowerCase();
    const filtered = !term ? data : data.filter(row =>
      Object.values(row).some(v => v !== null && v !== undefined && String(v).toLowerCase().includes(term))
    );
    renderTableData("settings", filtered, config);
  }, 250);

  setupFaviconCropper();
  setupAppearancePanel();
  if (sectionsData !== null) setupPageSectionsPanel(sectionsData);
}

function setupAppearancePanel() {
  const colorInput = document.getElementById("accentColorInput");
  const colorHex = document.getElementById("accentColorHex");
  const noteInput = document.getElementById("footerNoteInput");
  const saveBtn = document.getElementById("appearanceSaveBtn");
  const status = document.getElementById("appearanceStatus");

  colorInput.addEventListener("input", () => { colorHex.textContent = colorInput.value; });

  saveBtn.addEventListener("click", async () => {
    saveBtn.disabled = true;
    status.textContent = "Saving…";
    try {
      const r1 = await upsertSetting("theme_accent_color", colorInput.value);
      const r2 = await upsertSetting("footer_note", noteInput.value.trim());
      if (r1.error) throw new Error(r1.error.message);
      if (r2.error) throw new Error(r2.error.message);
      status.textContent = "Saved! It may take a minute to appear for visitors.";
      showToast("Appearance updated.");
      logActivity("Updated", "settings", "site appearance");
    } catch (err) {
      status.textContent = "";
      showToast("Error: " + err.message, "error");
    } finally {
      saveBtn.disabled = false;
    }
  });
}

function setupPageSectionsPanel(sections) {
  const list = document.getElementById("pageSectionsList");
  const status = document.getElementById("pageSectionsStatus");
  if (!list) return;

  function render() {
    list.innerHTML = sections.map(s => `
      <div class="page-section-row" draggable="true" data-id="${esc(s.id)}">
        <span class="drag-handle" title="Drag to reorder">⠿</span>
        <span class="page-section-label">${esc(s.label)}</span>
        <label class="page-section-toggle">
          <input type="checkbox" data-id="${esc(s.id)}" ${s.is_visible ? "checked" : ""} />
          <span>Visible</span>
        </label>
      </div>
    `).join("");

    list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener("change", async () => {
        const id = cb.dataset.id;
        const section = sections.find(s => String(s.id) === id);
        if (!section) return;
        section.is_visible = cb.checked;
        const { error } = await supabaseClient.from("page_sections").update({ is_visible: cb.checked }).eq("id", id);
        if (error) { showToast("Error: " + error.message, "error"); return; }
        status.textContent = "Saved.";
        showToast(`${section.label} is now ${cb.checked ? "visible" : "hidden"} on the site.`);
      });
    });

    let dragSrcId = null;
    list.querySelectorAll(".page-section-row").forEach(row => {
      row.addEventListener("dragstart", () => { dragSrcId = row.dataset.id; row.classList.add("dragging"); });
      row.addEventListener("dragend", () => {
        row.classList.remove("dragging");
        list.querySelectorAll(".page-section-row").forEach(r => r.classList.remove("drag-over"));
      });
      row.addEventListener("dragover", (e) => { e.preventDefault(); row.classList.add("drag-over"); });
      row.addEventListener("dragleave", () => row.classList.remove("drag-over"));
      row.addEventListener("drop", async (e) => {
        e.preventDefault();
        row.classList.remove("drag-over");
        const targetId = row.dataset.id;
        if (!dragSrcId || dragSrcId === targetId) return;

        const fromIndex = sections.findIndex(s => String(s.id) === dragSrcId);
        const toIndex = sections.findIndex(s => String(s.id) === targetId);
        if (fromIndex === -1 || toIndex === -1) return;

        const [moved] = sections.splice(fromIndex, 1);
        sections.splice(toIndex, 0, moved);
        sections.forEach((s, i) => { s.sort_order = i; });
        render();

        const results = await Promise.all(sections.map((s, i) => supabaseClient.from("page_sections").update({ sort_order: i }).eq("id", s.id)));
        const failed = results.find(r => r.error);
        if (failed) showToast("Error saving order: " + failed.error.message, "error");
        else showToast("Section order updated.");
      });
    });
  }

  render();
}



function setupFaviconCropper() {
  const frameSize = 220;
  const chooseBtn = document.getElementById("faviconChooseBtn");
  const cancelBtn = document.getElementById("faviconCancelBtn");
  const saveBtn = document.getElementById("faviconSaveBtn");
  const fileInput = document.getElementById("faviconFileInput");
  const cropArea = document.getElementById("faviconCropArea");
  const cropFrame = document.getElementById("faviconCropFrame");
  const cropImg = document.getElementById("faviconCropImg");
  const zoomSlider = document.getElementById("faviconZoom");
  const status = document.getElementById("faviconStatus");
  const currentPreview = document.getElementById("faviconCurrentPreview");

  let state = null; // { naturalW, naturalH, baseScale, zoom, offsetX, offsetY }

  function applyTransform() {
    const totalScale = state.baseScale * state.zoom;
    const dispW = state.naturalW * totalScale;
    const dispH = state.naturalH * totalScale;
    cropImg.style.width = `${dispW}px`;
    cropImg.style.height = `${dispH}px`;
    cropImg.style.left = `${state.offsetX}px`;
    cropImg.style.top = `${state.offsetY}px`;
  }

  function clampOffsets() {
    const totalScale = state.baseScale * state.zoom;
    const dispW = state.naturalW * totalScale;
    const dispH = state.naturalH * totalScale;
    state.offsetX = clamp(state.offsetX, frameSize - dispW, 0);
    state.offsetY = clamp(state.offsetY, frameSize - dispH, 0);
  }

  chooseBtn.addEventListener("click", () => fileInput.click());

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) { showToast("Image too large — max 8MB.", "error"); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const baseScale = Math.max(frameSize / img.naturalWidth, frameSize / img.naturalHeight);
        state = {
          naturalW: img.naturalWidth,
          naturalH: img.naturalHeight,
          baseScale,
          zoom: 1,
          offsetX: (frameSize - img.naturalWidth * baseScale) / 2,
          offsetY: (frameSize - img.naturalHeight * baseScale) / 2,
        };
        cropImg.src = reader.result;
        zoomSlider.value = 1;
        cropArea.style.display = "block";
        applyTransform();
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });

  zoomSlider.addEventListener("input", () => {
    if (!state) return;
    state.zoom = Number(zoomSlider.value);
    clampOffsets();
    applyTransform();
  });

  let dragging = false, dragStartX = 0, dragStartY = 0, startOffsetX = 0, startOffsetY = 0;

  function dragStart(clientX, clientY) {
    if (!state) return;
    dragging = true;
    dragStartX = clientX;
    dragStartY = clientY;
    startOffsetX = state.offsetX;
    startOffsetY = state.offsetY;
  }
  function dragMove(clientX, clientY) {
    if (!dragging || !state) return;
    state.offsetX = startOffsetX + (clientX - dragStartX);
    state.offsetY = startOffsetY + (clientY - dragStartY);
    clampOffsets();
    applyTransform();
  }
  function dragEnd() { dragging = false; }

  cropFrame.addEventListener("mousedown", (e) => dragStart(e.clientX, e.clientY));
  document.addEventListener("mousemove", (e) => dragMove(e.clientX, e.clientY));
  document.addEventListener("mouseup", dragEnd);
  cropFrame.addEventListener("touchstart", (e) => dragStart(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  cropFrame.addEventListener("touchmove", (e) => dragMove(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  cropFrame.addEventListener("touchend", dragEnd);

  cancelBtn.addEventListener("click", () => {
    cropArea.style.display = "none";
    fileInput.value = "";
    state = null;
  });

  saveBtn.addEventListener("click", () => {
    if (!state) return;
    const totalScale = state.baseScale * state.zoom;
    const sx = -state.offsetX / totalScale;
    const sy = -state.offsetY / totalScale;
    const sw = frameSize / totalScale;
    const sh = frameSize / totalScale;

    const outCanvas = document.createElement("canvas");
    outCanvas.width = 512;
    outCanvas.height = 512;
    const ctx = outCanvas.getContext("2d");
    ctx.drawImage(cropImg, sx, sy, sw, sh, 0, 0, 512, 512);

    outCanvas.toBlob(async (blob) => {
      if (!blob) { showToast("Couldn't process that image.", "error"); return; }
      status.textContent = "Uploading…";
      saveBtn.disabled = true;
      try {
        const path = "branding/favicon.png";
        const { error: upErr } = await supabaseClient.storage
          .from(STORAGE_BUCKET)
          .upload(path, blob, { upsert: true, contentType: "image/png" });
        if (upErr) throw new Error(upErr.message);

        const { data: pub } = supabaseClient.storage.from(STORAGE_BUCKET).getPublicUrl(path);
        const versionedUrl = `${pub.publicUrl}?v=${Date.now()}`;

        const { error: setErr } = await upsertSetting("favicon_url", versionedUrl);
        if (setErr) throw new Error(setErr.message);

        currentPreview.src = versionedUrl;
        currentPreview.style.opacity = 1;
        cropArea.style.display = "none";
        fileInput.value = "";
        state = null;
        status.textContent = "Saved! It may take a minute to appear for visitors.";
        showToast("Favicon updated.");
        logActivity("Updated", "settings", "favicon_url");
      } catch (err) {
        status.textContent = "";
        showToast("Error: " + err.message, "error");
      } finally {
        saveBtn.disabled = false;
      }
    }, "image/png");
  });
}


const TABLES = {
  profile: { label: "Profile", readOnly: false },
  projects: { label: "Projects", orderBy: "sort_order", ascending: true, readOnly: false },
  skill_categories: { label: "Skills", orderBy: "sort_order", readOnly: false },
  experience: { label: "Experience", orderBy: "sort_order", ascending: true, readOnly: false },
  education: { label: "Education", orderBy: "sort_order", ascending: true, readOnly: false },
  certifications: { label: "Certifications", orderBy: "sort_order", ascending: true, readOnly: false },
  testimonials: { label: "Testimonials", orderBy: "sort_order", ascending: true, readOnly: false },
  social_links: { label: "Social Links", orderBy: "sort_order", ascending: true, readOnly: false },
  contact_messages: { label: "Messages", orderBy: "created_at", readOnly: true },
  settings: { label: "Settings", orderBy: "key", ascending: true, readOnly: false },
  activity_log: { label: "Activity Log", orderBy: "created_at", readOnly: true },
};

let selectedIds = new Set();

async function renderTab(tabName) {
  const searchBox = document.getElementById("searchBox");
  selectedIds = new Set();

  if (tabName === "dashboard") { searchBox.style.display = "none"; renderDashboard(); return; }
  if (tabName === "analytics") { searchBox.style.display = "none"; renderAnalyticsTab(); return; }
  if (tabName === "profile") { searchBox.style.display = "none"; renderProfileTab(); return; }
  if (tabName === "skill_categories") { searchBox.style.display = "none"; renderSkillCategoriesTab(); return; }
  if (tabName === "settings") { searchBox.style.display = "none"; renderSettingsTab(); return; }

  const config = TABLES[tabName];
  const content = document.getElementById("tabContent");
  const pageTitle = document.getElementById("pageTitle");
  pageTitle.textContent = config.label;
  content.innerHTML = renderSkeleton();
  searchBox.style.display = "none";

  const { data, error } = await supabaseClient.from(tabName).select("*").order(config.orderBy, { ascending: config.ascending ?? false });

  if (error) {
    content.innerHTML = `<p style="color:var(--accent);">Error loading data: ${esc(error.message)}</p>`;
    return;
  }

  const html = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
      <h2>${esc(config.label)} (${data.length})</h2>
      <div style="display:flex;gap:0.6rem;">
        <button class="btn-secondary" id="exportBtn" style="width:auto;">Export CSV</button>
        ${!config.readOnly ? `<button class="btn-primary" id="addBtn">+ Add New</button>` : ""}
      </div>
    </div>
    <div class="bulk-bar" id="bulkBar" style="display:none;">
      <button class="btn-action danger" id="bulkDeleteBtn">Delete selected (<span id="bulkCount">0</span>)</button>
      <button class="btn-secondary" id="bulkClearBtn" style="width:auto;">Clear selection</button>
    </div>
    <div id="tableWrap" style="overflow-x:auto;"></div>
  `;

  content.innerHTML = html;

  document.getElementById("exportBtn").addEventListener("click", () => exportToCSV(data, `${tabName}.csv`));

  if (!config.readOnly) {
    document.getElementById("addBtn").addEventListener("click", () => openAddModal(tabName));
  }

  renderTableData(tabName, data, config);

  // wire up live search across all visible fields
  searchBox.style.display = "inline-block";
  searchBox.value = "";
  searchBox.placeholder = `Search ${config.label.toLowerCase()}...`;
  searchBox.oninput = debounce(() => {
    const term = searchBox.value.trim().toLowerCase();
    const filtered = !term ? data : data.filter(row =>
      Object.values(row).some(v => v !== null && v !== undefined && String(v).toLowerCase().includes(term))
    );
    renderTableData(tabName, filtered, config);
  }, 250);
}

function updateBulkBar(tabName) {
  const bar = document.getElementById("bulkBar");
  const countEl = document.getElementById("bulkCount");
  if (!bar) return;
  if (selectedIds.size > 0) {
    bar.style.display = "flex";
    countEl.textContent = selectedIds.size;
  } else {
    bar.style.display = "none";
  }
}

function renderTableData(tabName, data, config) {
  const wrap = document.getElementById("tableWrap");
  if (!wrap) return;

  if (!data || data.length === 0) {
    wrap.innerHTML = `<p style="color:var(--text-muted);text-align:center;padding:2rem;">No matching records</p>`;
    return;
  }

  const firstRow = data[0];
  const keys = Object.keys(firstRow).filter(k => k !== "id" && k !== "is_read").slice(0, 3);
  const isMessages = tabName === "contact_messages";
  const reorderable = config.orderBy === "sort_order" && !config.readOnly;

  wrap.innerHTML = `
    <table class="admin-table" id="dataTable">
      <thead>
        <tr>
          ${reorderable ? `<th class="drag-col"></th>` : ""}
          <th class="checkbox-col"><input type="checkbox" id="selectAllCheckbox" /></th>
          ${keys.map(k => `<th>${esc(k.replace(/_/g, " ").toUpperCase())}</th>`).join("")}
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        ${data.map(row => `
          <tr ${reorderable ? `draggable="true" data-row-id="${esc(row.id)}"` : ""}>
            ${reorderable ? `<td class="drag-col"><span class="drag-handle" title="Drag to reorder">⠿</span></td>` : ""}
            <td class="checkbox-col"><input type="checkbox" class="row-select" data-id="${esc(row.id)}" ${selectedIds.has(row.id) ? "checked" : ""} /></td>
            ${keys.map((k, i) => `<td>${i === 0 && isMessages && row.is_read === false ? `<span class="msg-unread-dot"></span>` : ""}${esc(String(row[k] ?? "—").slice(0, 50))}</td>`).join("")}
            <td class="row-actions">
              ${isMessages && row.email ? `<button class="btn-action reply-btn" data-id="${esc(row.id)}">Reply</button>` : ""}
              ${!config.readOnly ? `<button class="btn-action edit-btn" data-id="${esc(row.id)}">Edit</button>` : `<button class="btn-action view-btn" data-id="${esc(row.id)}">View</button>`}
              <button class="btn-action danger delete-btn" data-id="${esc(row.id)}">Delete</button>
            </td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;

  const table = document.getElementById("dataTable");

  if (reorderable) {
    let dragSrcId = null;
    table.querySelectorAll("tbody tr[draggable='true']").forEach(tr => {
      tr.addEventListener("dragstart", () => {
        dragSrcId = tr.dataset.rowId;
        tr.classList.add("dragging");
      });
      tr.addEventListener("dragend", () => {
        tr.classList.remove("dragging");
        table.querySelectorAll("tbody tr").forEach(r => r.classList.remove("drag-over"));
      });
      tr.addEventListener("dragover", (e) => {
        e.preventDefault();
        tr.classList.add("drag-over");
      });
      tr.addEventListener("dragleave", () => {
        tr.classList.remove("drag-over");
      });
      tr.addEventListener("drop", async (e) => {
        e.preventDefault();
        tr.classList.remove("drag-over");
        const targetId = tr.dataset.rowId;
        if (!dragSrcId || dragSrcId === targetId) return;

        const fromIndex = data.findIndex(r => String(r.id) === dragSrcId);
        const toIndex = data.findIndex(r => String(r.id) === targetId);
        if (fromIndex === -1 || toIndex === -1) return;

        const [moved] = data.splice(fromIndex, 1);
        data.splice(toIndex, 0, moved);
        data.forEach((r, i) => { r.sort_order = i; });
        renderTableData(tabName, data, config);

        const results = await Promise.all(data.map((r, i) => supabaseClient.from(tabName).update({ sort_order: i }).eq("id", r.id)));
        const failed = results.find(r => r.error);
        if (failed) showToast("Error saving order: " + failed.error.message, "error");
        else showToast("Order updated.");
      });
    });
  }

  const selectAllEl = document.getElementById("selectAllCheckbox");
  selectAllEl.addEventListener("change", () => {
    table.querySelectorAll(".row-select").forEach(cb => {
      cb.checked = selectAllEl.checked;
      if (selectAllEl.checked) selectedIds.add(cb.dataset.id); else selectedIds.delete(cb.dataset.id);
    });
    updateBulkBar(tabName);
  });

  table.querySelectorAll(".row-select").forEach(cb => {
    cb.addEventListener("change", () => {
      if (cb.checked) selectedIds.add(cb.dataset.id); else selectedIds.delete(cb.dataset.id);
      updateBulkBar(tabName);
    });
  });

  const bulkDeleteBtn = document.getElementById("bulkDeleteBtn");
  const bulkClearBtn = document.getElementById("bulkClearBtn");
  if (bulkDeleteBtn) {
    bulkDeleteBtn.onclick = async () => {
      const ok = await showConfirm(`Delete ${selectedIds.size} selected record(s)? This can't be undone.`);
      if (!ok) return;
      const { error } = await supabaseClient.from(tabName).delete().in("id", Array.from(selectedIds));
      if (error) { showToast("Error deleting: " + error.message, "error"); return; }
      showToast(`${selectedIds.size} record(s) deleted.`);
      logActivity("Bulk deleted", tabName, `${selectedIds.size} record(s)`);
      selectedIds = new Set();
      renderTab(tabName);
      if (tabName === "contact_messages") refreshNotifications();
    };
  }
  if (bulkClearBtn) {
    bulkClearBtn.onclick = () => { selectedIds = new Set(); renderTab(tabName); };
  }
  updateBulkBar(tabName);

  table.querySelectorAll(".reply-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const row = data.find(r => String(r.id) === btn.dataset.id);
      if (row.is_read === false) {
        const { error: readErr } = await supabaseClient.from("contact_messages").update({ is_read: true }).eq("id", row.id);
        if (readErr) {
          showToast("Couldn't mark as read: " + readErr.message, "error");
        } else {
          row.is_read = true;
          renderTableData(tabName, data, config);
          refreshNotifications();
        }
      }
      const subject = `Re: ${row.subject || "your message"}`;
      const body = `Hi ${row.name || ""},\n\n\n\n---\nOn your message: "${row.message || ""}"`;
      window.open(buildGmailComposeUrl(row.email, subject, body), "_blank");
    });
  });

  table.querySelectorAll(".edit-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const row = data.find(r => String(r.id) === btn.dataset.id);
      openEditModal(tabName, row);
    });
  });

  table.querySelectorAll(".view-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const row = data.find(r => String(r.id) === btn.dataset.id);
      if (isMessages && row.is_read === false) {
        const { error: readErr } = await supabaseClient.from("contact_messages").update({ is_read: true }).eq("id", row.id);
        if (readErr) {
          showToast("Couldn't mark as read: " + readErr.message, "error");
        } else {
          row.is_read = true;
          renderTableData(tabName, data, config);
          refreshNotifications();
        }
      }
      openViewModal(tabName, row);
    });
  });

  table.querySelectorAll(".delete-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const ok = await showConfirm("Delete this record? This can't be undone.");
      if (!ok) return;
      btn.disabled = true;
      const row = data.find(r => String(r.id) === btn.dataset.id);
      const label = row?.title || row?.name || row?.full_name || row?.company || row?.platform || row?.institution || row?.key;
      const { error } = await supabaseClient.from(tabName).delete().eq("id", btn.dataset.id);
      if (error) { showToast("Error deleting: " + error.message, "error"); btn.disabled = false; return; }
      showToast("Record deleted.");
      logActivity("Deleted", tabName, label ? String(label).slice(0, 100) : "");
      renderTab(tabName);
      if (tabName === "contact_messages") refreshNotifications();
    });
  });
}

// ==========================================
// SKILLS TAB (skill_categories: name, proficiency, skills_list, sort_order)
// skills_list is a comma-separated text field — "Manage Skills" edits it
// as a friendly add/edit/delete list instead of raw text.
// ==========================================
function parseSkillsList(str) {
  return (str || "").split(",").map(s => s.trim()).filter(Boolean);
}

async function renderSkillCategoriesTab() {
  const pageTitle = document.getElementById("pageTitle");
  pageTitle.textContent = "Skills";
  const content = document.getElementById("tabContent");
  content.innerHTML = renderSkeleton();

  const { data, error } = await supabaseClient.from("skill_categories").select("*").order("sort_order", { ascending: true });

  if (error) {
    content.innerHTML = `<p style="color:var(--accent);">Error loading data: ${esc(error.message)}</p>`;
    return;
  }

  const categories = data || [];

  content.innerHTML = `
    <p class="dash-subtitle">Skill categories shown as cards, each with individual skills listed underneath.</p>
    <div style="display:flex;justify-content:flex-end;margin-bottom:1.5rem;">
      <button class="btn-primary" id="addCategoryBtn">+ Add Category</button>
    </div>
    <div class="dash-list" id="skillCatList">
      ${categories.length === 0 ? `<p style="color:var(--text-muted);text-align:center;padding:2rem;">No skill categories yet</p>` :
        categories.map(cat => {
          const skills = parseSkillsList(cat.skills_list);
          const skillNames = skills.join(", ") || "No skills added yet";
          const pct = (cat.proficiency !== null && cat.proficiency !== undefined) ? ` (${esc(cat.proficiency)}%)` : "";
          return `
            <div class="dash-row skill-cat-row">
              <div class="skill-cat-info">
                <div class="dash-label">${esc(cat.name)}${pct}</div>
                <div class="skill-cat-sub">${esc(skillNames)}</div>
              </div>
              <div class="row-actions">
                <button type="button" class="btn-action manage-skills-btn" data-id="${esc(cat.id)}">Manage Skills</button>
                <button type="button" class="btn-action edit-cat-btn" data-id="${esc(cat.id)}">Edit</button>
                <button type="button" class="btn-action danger delete-cat-btn" data-id="${esc(cat.id)}">Delete</button>
              </div>
            </div>`;
        }).join("")}
    </div>
  `;

  document.getElementById("addCategoryBtn").addEventListener("click", () => openAddModal("skill_categories"));

  content.querySelectorAll(".edit-cat-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const cat = categories.find(c => String(c.id) === btn.dataset.id);
      openEditModal("skill_categories", cat);
    });
  });

  content.querySelectorAll(".delete-cat-btn").forEach(btn => {
    btn.addEventListener("click", async () => {
      const ok = await showConfirm("Delete this category?");
      if (!ok) return;
      const { error } = await supabaseClient.from("skill_categories").delete().eq("id", btn.dataset.id);
      if (error) { showToast("Error: " + error.message, "error"); return; }
      showToast("Category deleted.");
      logActivity("Deleted", "skill_categories", "Skill category");
      renderSkillCategoriesTab();
    });
  });

  content.querySelectorAll(".manage-skills-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const cat = categories.find(c => String(c.id) === btn.dataset.id);
      openManageSkillsModal(cat);
    });
  });
}

function openManageSkillsModal(category) {
  modalMode = null;
  modalTable = null;
  modalRowId = null;
  modalTitle.textContent = `Manage Skills — ${category.name}`;
  modalOverlay.style.display = "flex";
  renderManageSkillsBody(category, parseSkillsList(category.skills_list));
}

function renderManageSkillsBody(category, skills) {
  modalForm.innerHTML = `
    <div class="skill-manage-list">
      ${skills.length === 0 ? `<p style="color:var(--text-muted);font-size:0.85rem;">No skills yet.</p>` :
        skills.map((name, idx) => `
        <div class="skill-manage-row" data-idx="${idx}">
          <span class="skill-manage-name">${esc(name)}</span>
          <div class="row-actions">
            <button type="button" class="btn-action edit-skill-btn" data-idx="${idx}">Edit</button>
            <button type="button" class="btn-action danger delete-skill-btn" data-idx="${idx}">Delete</button>
          </div>
        </div>`).join("")}
    </div>
    <div class="skill-add-row">
      <input type="text" id="newSkillName" placeholder="Skill name" />
      <button type="button" class="btn-primary" id="addSkillBtn">Add</button>
    </div>
    <p class="form-status" id="skillManageStatus"></p>
    <div class="modal-actions">
      <button type="button" class="btn-secondary" id="modalCancelBtn">Close</button>
    </div>
  `;

  document.getElementById("modalCancelBtn").addEventListener("click", closeModal);

  document.getElementById("addSkillBtn").addEventListener("click", () => {
    const input = document.getElementById("newSkillName");
    const name = input.value.trim();
    if (!name) return;
    saveSkillsList(category, [...skills, name]);
  });

  modalForm.querySelectorAll(".delete-skill-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      saveSkillsList(category, skills.filter((_, i) => i !== idx));
    });
  });

  modalForm.querySelectorAll(".edit-skill-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      const row = modalForm.querySelector(`.skill-manage-row[data-idx="${idx}"]`);
      row.innerHTML = `
        <input type="text" class="edit-skill-name" value="${esc(skills[idx])}" />
        <div class="row-actions">
          <button type="button" class="btn-action save-skill-btn">Save</button>
        </div>
      `;
      row.querySelector(".save-skill-btn").addEventListener("click", () => {
        const newName = row.querySelector(".edit-skill-name").value.trim();
        if (!newName) return;
        const updated = [...skills];
        updated[idx] = newName;
        saveSkillsList(category, updated);
      });
    });
  });
}

async function saveSkillsList(category, updatedSkills) {
  const statusEl = document.getElementById("skillManageStatus");
  if (statusEl) statusEl.textContent = "Saving…";

  const newValue = updatedSkills.join(", ");
  const { error } = await supabaseClient.from("skill_categories").update({ skills_list: newValue }).eq("id", category.id);

  if (error) {
    if (statusEl) statusEl.textContent = "Error: " + error.message;
    return;
  }

  category.skills_list = newValue;
  renderManageSkillsBody(category, updatedSkills);
  if (currentTab === "skill_categories") renderSkillCategoriesTab();
}

// ==========================================
// PROFILE TAB
// ==========================================
const PROFILE_FIELDS = [
  { name: "full_name", label: "Full Name", type: "text" },
  { name: "professional_title", label: "Professional Title", type: "text" },
  { name: "tagline", label: "Tagline / Short Bio", type: "textarea" },
  { name: "hero_heading", label: "Hero Heading", type: "text" },
  { name: "hero_subheading", label: "Hero Subheading", type: "text" },
  { name: "hero_photo_url", label: "Hero Photo", type: "file" },
  { name: "about_heading", label: "About Heading", type: "text" },
  { name: "about_paragraphs", label: "About Text (one paragraph per line)", type: "textarea" },
  { name: "about_photo_url", label: "About Section Photo", type: "file" },
  { name: "resume_url", label: "Resume (PDF)", type: "file", accept: "application/pdf" },
];

async function renderProfileTab() {
  const pageTitle = document.getElementById("pageTitle");
  pageTitle.textContent = "Profile";
  document.getElementById("tabContent").innerHTML = renderSkeleton(8);

  const { data } = await supabaseClient.from("profile").select("*").limit(1).maybeSingle();
  profileRowId = data ? data.id : null;

  const content = document.getElementById("tabContent");
  content.innerHTML = `
    <div style="max-width:600px;">
      <form id="profileForm">
        ${PROFILE_FIELDS.map(f => renderField(f, data || {})).join("")}
        <button type="submit" class="btn-primary" style="margin-top:1rem;">Save Profile</button>
        <p class="form-status" id="profileStatus"></p>
      </form>
    </div>
  `;

  wireFileInputs(document.getElementById("profileForm"));

  document.getElementById("profileForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const statusEl = document.getElementById("profileStatus");
    statusEl.textContent = "Saving…";

    try {
      const payload = await collectFormData(PROFILE_FIELDS, e.target);

      if (profileRowId) {
        const { error } = await supabaseClient.from("profile").update(payload).eq("id", profileRowId);
        if (error) throw error;
      } else {
        const { error } = await supabaseClient.from("profile").insert([payload]);
        if (error) throw error;
      }
      statusEl.textContent = "Saved!";
      showToast("Profile saved.");
      logActivity("Updated", "profile", "Profile info");
      renderProfileTab();
    } catch (err) {
      statusEl.textContent = "Error: " + err.message;
      showToast("Error: " + err.message, "error");
    }
  });
}

// ==========================================
// FIELD RENDERING HELPERS (shared by profile + modals)
// ==========================================
function renderField(f, row) {
  const value = row[f.name];

  if (f.type === "textarea") {
    return `
      <div class="form-group">
        <label>${esc(f.label)}</label>
        <textarea name="${esc(f.name)}" rows="4" ${f.required ? "required" : ""}>${esc(value || "")}</textarea>
      </div>`;
  }

  if (f.type === "checkbox") {
    const checked = value !== undefined ? !!value : !!f.default;
    return `
      <div class="form-group form-group-checkbox">
        <label class="checkbox-label">
          <input type="checkbox" name="${esc(f.name)}" ${checked ? "checked" : ""} />
          ${esc(f.label)}
        </label>
      </div>`;
  }

  if (f.type === "file") {
    const isImg = value && !/\.pdf($|\?)/i.test(value);
    return `
      <div class="form-group">
        <label>${esc(f.label)}</label>
        <input type="file" name="${esc(f.name)}__file" accept="${esc(f.accept || "image/*,video/*")}" data-target="${esc(f.name)}" />
        ${value ? `
          <div class="file-current-row" data-current-row="${esc(f.name)}">
            ${isImg ? `<img class="file-preview-img" src="${esc(sanitizeUrl(value))}" alt="" onerror="this.style.display='none'" />` : ""}
            <small class="file-current">Current: <a href="${esc(sanitizeUrl(value))}" target="_blank" rel="noopener">view file</a></small>
            <button type="button" class="file-remove-btn" data-remove-target="${esc(f.name)}">Remove</button>
          </div>` : ""}
        <input type="hidden" name="${esc(f.name)}" value="${esc(value || "")}" data-hidden-target="${esc(f.name)}" />
      </div>`;
  }

  if (f.type === "date") {
    return `
      <div class="form-group">
        <label>${esc(f.label)}</label>
        <input type="date" name="${esc(f.name)}" value="${esc(toDateInputValue(value))}" ${f.required ? "required" : ""} />
      </div>`;
  }

  if (f.type === "number") {
    return `
      <div class="form-group">
        <label>${esc(f.label)}</label>
        <input type="number" name="${esc(f.name)}" value="${value !== undefined && value !== null ? esc(value) : ""}" ${f.min !== undefined ? `min="${f.min}"` : ""} ${f.max !== undefined ? `max="${f.max}"` : ""} ${f.required ? "required" : ""} />
      </div>`;
  }

  const inputType = f.type === "url" ? "url" : "text";
  const displayValue = Array.isArray(value) ? value.join(", ") : (value || "");
  return `
    <div class="form-group">
      <label>${esc(f.label)}</label>
      <input type="${inputType}" name="${esc(f.name)}" value="${esc(displayValue)}" placeholder="${f.type === "array" ? "e.g. React, Node.js, Supabase" : ""}" ${f.required ? "required" : ""} />
    </div>`;
}

// Show a filename + live thumbnail preview next to file inputs once chosen
function wireFileInputs(container) {
  container.querySelectorAll('input[type="file"]').forEach(input => {
    input.addEventListener("change", () => {
      const file = input.files[0];
      const parent = input.parentElement;
      const existingLabel = parent.querySelector(".file-chosen");
      const existingPreview = parent.querySelector(".file-preview-img");
      if (existingLabel) existingLabel.remove();
      if (existingPreview) existingPreview.remove();

      if (!file) return;

      const label = document.createElement("small");
      label.className = "file-chosen";
      label.textContent = `Selected: ${file.name}`;
      input.after(label);

      if (file.type.startsWith("image/")) {
        const img = document.createElement("img");
        img.className = "file-preview-img";
        img.src = URL.createObjectURL(file);
        label.after(img);
      }
    });
  });

  // "Remove" button — clears the stored file so saving the form removes
  // the image/PDF from this field (the field becomes empty, nothing is
  // deleted from Storage, it's just no longer referenced by this record).
  container.querySelectorAll(".file-remove-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      const targetName = btn.dataset.removeTarget;
      const hiddenInput = container.querySelector(`input[type="hidden"][data-hidden-target="${targetName}"]`);
      const fileInput = container.querySelector(`input[type="file"][data-target="${targetName}"]`);
      const row = container.querySelector(`[data-current-row="${targetName}"]`);
      if (hiddenInput) hiddenInput.value = "";
      if (fileInput) fileInput.value = "";
      if (row) row.remove();
    });
  });
}

const MAX_UPLOAD_MB = 8;
const ALLOWED_UPLOAD_TYPES = /^(image\/|video\/|application\/pdf)/;
// Strip anything that isn't a safe filename character before using it in a
// storage path, so uploaded filenames can't be used to traverse folders.
function safeExt(filename) {
  const ext = (filename.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  return ext.slice(0, 8) || "bin";
}

async function uploadFile(file, folder) {
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    throw new Error(`File too large — max ${MAX_UPLOAD_MB}MB (this file is ${(file.size / 1024 / 1024).toFixed(1)}MB).`);
  }
  if (file.type && !ALLOWED_UPLOAD_TYPES.test(file.type)) {
    throw new Error(`Unsupported file type "${file.type}". Only images, videos, or PDFs are allowed.`);
  }
  const ext = safeExt(file.name);
  const safeFolder = String(folder).replace(/[^a-z0-9_-]/gi, "");
  const path = `${safeFolder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await supabaseClient.storage.from(STORAGE_BUCKET).upload(path, file, { upsert: false });
  if (error) throw new Error(`Upload failed (bucket "${STORAGE_BUCKET}"): ${error.message}`);
  const { data } = supabaseClient.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

// Reads a form built from `schema`, uploads any chosen files, and returns
// a plain object ready to insert/update in Supabase.
async function collectFormData(schema, formEl) {
  const formData = new FormData(formEl);
  const payload = {};

  for (const f of schema) {
    if (f.type === "file") {
      const fileInput = formEl.querySelector(`input[type="file"][data-target="${f.name}"]`);
      const chosen = fileInput?.files?.[0];
      if (chosen) {
        payload[f.name] = await uploadFile(chosen, f.name);
      } else {
        payload[f.name] = formData.get(f.name) || null;
      }
    } else if (f.type === "checkbox") {
      payload[f.name] = formData.get(f.name) === "on";
    } else if (f.type === "number") {
      const raw = formData.get(f.name);
      payload[f.name] = raw === "" || raw === null ? null : Number(raw);
    } else if (f.type === "array") {
      const raw = formData.get(f.name) || "";
      payload[f.name] = raw.split(",").map(s => s.trim()).filter(Boolean);
    } else if (f.type === "url") {
      const raw = (formData.get(f.name) || "").trim();
      if (raw && !/^https?:\/\//i.test(raw)) {
        throw new Error(`"${f.label}" must start with http:// or https://`);
      }
      payload[f.name] = raw === "" ? null : raw;
    } else {
      const raw = formData.get(f.name);
      payload[f.name] = raw === "" ? null : raw;
    }
  }

  return payload;
}

// ==========================================
// MODALS (Add / Edit / View)
// ==========================================
const modalOverlay = document.getElementById("modalOverlay");
const modalForm = document.getElementById("modalForm");
const modalTitle = document.getElementById("modalTitle");

function closeModal() {
  modalOverlay.style.display = "none";
  modalForm.innerHTML = "";
  modalMode = null;
  modalTable = null;
  modalRowId = null;
}

document.getElementById("modalClose").addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => { if (e.target === modalOverlay) closeModal(); });

function getSchema(tabName, row) {
  return FIELD_SCHEMAS[tabName] || inferSchemaFromRow(row || {});
}

function openAddModal(tabName) {
  modalMode = "add";
  modalTable = tabName;
  modalRowId = null;
  modalTitle.textContent = `Add ${TABLES[tabName].label}`;
  modalOverlay.style.display = "flex";

  const schema = getSchema(tabName, {});
  modalForm.innerHTML = `
    ${schema.map(f => renderField(f, {})).join("")}
    <div class="modal-actions">
      <button type="button" class="btn-secondary" id="modalCancelBtn">Cancel</button>
      <button type="submit" class="btn-primary">Save</button>
    </div>
    <p class="form-status" id="modalStatus"></p>
  `;
  wireFileInputs(modalForm);
  document.getElementById("modalCancelBtn").addEventListener("click", closeModal);
}

function openEditModal(tabName, row) {
  modalMode = "edit";
  modalTable = tabName;
  modalRowId = row.id;
  modalTitle.textContent = `Edit ${TABLES[tabName].label}`;
  modalOverlay.style.display = "flex";

  const schema = getSchema(tabName, row);
  modalForm.innerHTML = `
    ${schema.map(f => renderField(f, row)).join("")}
    <div class="modal-actions">
      <button type="button" class="btn-secondary" id="modalCancelBtn">Cancel</button>
      <button type="submit" class="btn-primary">Update</button>
    </div>
    <p class="form-status" id="modalStatus"></p>
  `;
  wireFileInputs(modalForm);
  document.getElementById("modalCancelBtn").addEventListener("click", closeModal);
}

function openViewModal(tabName, row) {
  modalMode = null;
  modalTitle.textContent = `View ${TABLES[tabName].label}`;
  modalOverlay.style.display = "flex";

  const entries = Object.keys(row).filter(k => !["id"].includes(k));
  modalForm.innerHTML = `
    <div class="view-grid">
      ${entries.map(k => `
        <div class="form-group">
          <label>${esc(k.replace(/_/g, " "))}</label>
          <p style="white-space:pre-wrap;">${esc(row[k] ?? "—")}</p>
        </div>
      `).join("")}
    </div>
    <div class="modal-actions">
      <button type="button" class="btn-secondary" id="modalCancelBtn">Close</button>
      ${tabName === "contact_messages" && row.email ? `<button type="button" class="btn-primary" id="modalReplyBtn">Reply</button>` : ""}
      <button type="button" class="btn-action danger" id="modalDeleteBtn">Delete</button>
    </div>
  `;
  document.getElementById("modalCancelBtn").addEventListener("click", closeModal);
  const replyBtn = document.getElementById("modalReplyBtn");
  if (replyBtn) {
    replyBtn.addEventListener("click", () => {
      const subject = `Re: ${row.subject || "your message"}`;
      const body = `Hi ${row.name || ""},\n\n\n\n---\nOn your message: "${row.message || ""}"`;
      window.open(buildGmailComposeUrl(row.email, subject, body), "_blank");
    });
  }
  document.getElementById("modalDeleteBtn").addEventListener("click", async () => {
    const ok = await showConfirm("Delete this message?");
    if (!ok) return;
    await supabaseClient.from(tabName).delete().eq("id", row.id);
    showToast("Message deleted.");
    closeModal();
    renderTab(tabName);
    if (tabName === "contact_messages") refreshNotifications();
  });
}

// Single submit handler for both Add and Edit modes
modalForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!modalMode || !modalTable) return;

  const statusEl = document.getElementById("modalStatus");
  const submitBtn = modalForm.querySelector('button[type="submit"]');
  if (statusEl) statusEl.textContent = "Saving…";
  if (submitBtn) submitBtn.disabled = true;

  try {
    const schema = getSchema(modalTable, modalMode === "edit" ? { id: modalRowId } : {});
    const payload = await collectFormData(schema, modalForm);

    if (modalMode === "add") {
      const { error } = await supabaseClient.from(modalTable).insert([payload]);
      if (error) throw error;
    } else {
      const { error } = await supabaseClient.from(modalTable).update(payload).eq("id", modalRowId);
      if (error) throw error;
    }

    const savedTable = modalTable;
    const wasAdd = modalMode === "add";
    const label = payload.title || payload.name || payload.full_name || payload.company ||
                  payload.platform || payload.institution || payload.key || TABLES[savedTable]?.label || savedTable;
    closeModal();
    showToast(wasAdd ? "Added successfully." : "Updated successfully.");
    logActivity(wasAdd ? "Created" : "Updated", savedTable, String(label).slice(0, 100));
    renderTab(savedTable);
  } catch (err) {
    if (statusEl) statusEl.textContent = "Error: " + err.message;
    showToast("Error: " + err.message, "error");
    if (submitBtn) submitBtn.disabled = false;
  }
});

// ==========================================
// PASSWORD CHANGE
// ==========================================
document.getElementById("changePasswordBtn").addEventListener("click", () => {
  document.getElementById("passwordModalOverlay").style.display = "flex";
});

document.getElementById("passwordModalClose").addEventListener("click", () => {
  document.getElementById("passwordModalOverlay").style.display = "none";
});

document.getElementById("passwordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const newPass = document.getElementById("newPassword").value;
  const confirmPass = document.getElementById("confirmPassword").value;
  const statusEl = document.getElementById("passwordStatus");

  if (newPass !== confirmPass) {
    statusEl.textContent = "Passwords don't match";
    return;
  }

  statusEl.textContent = "Updating…";
  const { error } = await supabaseClient.auth.updateUser({ password: newPass });

  if (error) {
    statusEl.textContent = "Error: " + error.message;
    return;
  }

  statusEl.textContent = "Password updated!";
  setTimeout(() => { document.getElementById("passwordModalOverlay").style.display = "none"; }, 1000);
});

// ==========================================
// THEME TOGGLE (light/dark)
// ==========================================
const themeToggleBtn = document.getElementById("themeToggle");
if (themeToggleBtn) {
  themeToggleBtn.addEventListener("click", () => {
    document.body.classList.toggle("light-theme");
    themeToggleBtn.textContent = document.body.classList.contains("light-theme") ? "☀️" : "🌙";
  });
}

// ==========================================
// AMBIENT SHOOTING STARS
// ==========================================
function initShootingStars() {
  const container = document.getElementById("starsBg");
  if (!container) return;

  // faint twinkling backdrop
  const TWINKLE_COUNT = 45;
  for (let i = 0; i < TWINKLE_COUNT; i++) {
    const t = document.createElement("span");
    t.className = "twinkle-star";
    t.style.left = (Math.random() * 100).toFixed(1) + "vw";
    t.style.top = (Math.random() * 100).toFixed(1) + "vh";
    t.style.animationDuration = (Math.random() * 3 + 2).toFixed(2) + "s";
    t.style.animationDelay = (Math.random() * 4).toFixed(2) + "s";
    container.appendChild(t);
  }

  // bright shooting stars, sweeping from the top-right (moon icon) toward
  // the bottom-left (logout button) — direction computed per star so the
  // glowing tail always lines up exactly with its motion.
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const STAR_COUNT = 6;
  for (let i = 0; i < STAR_COUNT; i++) {
    const star = document.createElement("span");
    star.className = "shooting-star";

    // start near the top-right area, with some natural spread
    const startLeftVw = Math.random() * 32 + 55; // 55vw - 87vw
    const startTopVh = Math.random() * 14 - 8;   // -8vh - 6vh
    star.style.left = startLeftVw + "vw";
    star.style.top = startTopVh + "vh";

    // travel toward the bottom-left, with slight per-star variation
    const jitter = (Math.random() - 0.5) * 0.3;
    const dx = -(vw * (0.72 + jitter));
    const dy = (vh * (0.9 + jitter * 0.5));

    // derive the tail rotation that matches this exact travel direction
    const bearing = Math.atan2(dx, -dy) * (180 / Math.PI);
    const tailRotate = ((bearing - 90) + 360) % 360;

    star.style.setProperty("--dx", dx.toFixed(1) + "px");
    star.style.setProperty("--dy", dy.toFixed(1) + "px");
    star.style.setProperty("--tail-rotate", tailRotate.toFixed(1) + "deg");
    star.style.setProperty("--scale", (Math.random() * 0.5 + 0.65).toFixed(2));

    star.style.animationDuration = (Math.random() * 2.5 + 3.2).toFixed(2) + "s";
    star.style.animationDelay = (Math.random() * 8).toFixed(2) + "s";

    container.appendChild(star);
  }
}
initShootingStars();

// ==========================================
// LIVE CLOCK
// ==========================================
function updateLiveClock() {
  const el = document.getElementById("liveClock");
  if (!el) return;
  const now = new Date();
  el.textContent = now.toLocaleDateString("en-US", { weekday: "short" }) + ", " +
    now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
updateLiveClock();
setInterval(updateLiveClock, 1000);

// ==========================================
// SESSION EXPIRY HANDLING
// If the session expires or the user is signed out elsewhere,
// gracefully return to the login screen instead of leaving a broken UI.
// ==========================================
let lastKnownSignedIn = null;
supabaseClient.auth.onAuthStateChange((event, session) => {
  if (event === "PASSWORD_RECOVERY") {
    checkSession().then(() => {
      document.getElementById("passwordModalOverlay").style.display = "flex";
      showToast("Set your new password below.");
    });
    return;
  }
  const isSignedIn = !!session;
  if (lastKnownSignedIn === null) { lastKnownSignedIn = isSignedIn; return; }
  if (lastKnownSignedIn && !isSignedIn) {
    showToast("Your session expired. Please log in again.", "error");
    checkSession();
  }
  lastKnownSignedIn = isSignedIn;
});

// ==========================================
// KEYBOARD SHORTCUTS
// Ctrl/Cmd+S saves the open form, Esc closes modals, / focuses search
// ==========================================
document.addEventListener("keydown", (e) => {
  const isSaveCombo = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s";

  if (isSaveCombo) {
    if (modalOverlay.style.display === "flex" && modalMode) {
      e.preventDefault();
      modalForm.dispatchEvent(new Event("submit", { cancelable: true }));
      return;
    }
    const profileForm = document.getElementById("profileForm");
    if (profileForm) {
      e.preventDefault();
      profileForm.dispatchEvent(new Event("submit", { cancelable: true }));
      return;
    }
  }

  if (e.key === "Escape") {
    if (modalOverlay.style.display === "flex") { closeModal(); return; }
    const pwOverlay = document.getElementById("passwordModalOverlay");
    if (pwOverlay && pwOverlay.style.display === "flex") { pwOverlay.style.display = "none"; return; }
  }

  if (e.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    const searchBox = document.getElementById("searchBox");
    if (searchBox && searchBox.style.display !== "none") {
      e.preventDefault();
      searchBox.focus();
    }
  }
});

// ==========================================
// INIT
// ==========================================
checkSession();
