// ==========================================
// CUTE ASTRONAUT MASCOT — wanders around the screen
// ==========================================
(function () {
  const mascot = document.getElementById("astronautMascot");
  if (!mascot) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  function randomPoint() {
    const margin = 70;
    return {
      x: margin + Math.random() * (window.innerWidth - margin * 2),
      y: margin + Math.random() * (window.innerHeight - margin * 2),
    };
  }

  let current = randomPoint();
  mascot.style.transform = `translate(${current.x}px, ${current.y}px)`;

  function moveNext() {
    const next = randomPoint();
    const dist = Math.hypot(next.x - current.x, next.y - current.y);
    const duration = Math.max(2.5, Math.min(7, dist / 55));

    mascot.style.transition = `transform ${duration}s ease-in-out`;
    mascot.classList.toggle("facing-left", next.x < current.x);
    mascot.style.transform = `translate(${next.x}px, ${next.y}px)`;

    current = next;
    setTimeout(moveNext, duration * 1000 + 900 + Math.random() * 1800);
  }

  setTimeout(moveNext, 1200);
})();

// ==========================================
// SCROLL REVEAL
// ==========================================
const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      entry.target.classList.add("is-visible");
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });

function observeReveals(root = document) {
  root.querySelectorAll(".reveal:not(.is-visible)").forEach(el => revealObserver.observe(el));
}

// ==========================================
// STARFIELD BACKGROUND (twinkling stars + shooting stars)
// ==========================================
(function () {
  const canvas = document.getElementById("starfield");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let width, height, stars, shootingStars;

  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
  }

  function makeStars() {
    const count = Math.floor((width * height) / 35000);
    stars = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: Math.random() * 0.9 + 0.3,
      baseAlpha: Math.random() * 0.25 + 0.12,
      twinkleSpeed: Math.random() * 0.02 + 0.005,
      phase: Math.random() * Math.PI * 2,
    }));
  }

  function makeShootingStar() {
    const startX = Math.random() * width;
    const startY = -15 - Math.random() * (height * 0.1);

    // travel from top toward the lower OPPOSITE side (crosses the screen diagonally)
    const startsLeftSide = startX < width / 2;
    const goingRight = startsLeftSide ? Math.random() < 0.88 : Math.random() < 0.12;
    const dir = goingRight ? 1 : -1;

    const angle = (Math.PI * 0.28) + Math.random() * 0.22; // steep-ish diagonal
    const speed = Math.random() * 5 + 11; // fast

    return {
      x: startX, y: startY,
      vx: Math.cos(angle) * speed * dir,
      vy: Math.sin(angle) * speed,
      life: 0,
      maxLife: Math.random() * 18 + 32, // short-lived -> short trail, quick pass
      delay: Math.floor(Math.random() * 15), // tiny natural stagger only
    };
  }

  resize();
  makeStars();
  shootingStars = [];
  let frame = 0;
  let nextSpawnIn = 10 + Math.random() * 30;

  function tick() {
    frame++;
    ctx.clearRect(0, 0, width, height);

    // twinkling stars (unchanged)
    stars.forEach(s => {
      const alpha = s.baseAlpha + Math.sin(frame * s.twinkleSpeed + s.phase) * 0.12;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,255,255,${Math.max(0, Math.min(1, alpha))})`;
      ctx.fill();
    });

    // randomized natural spawn timing for shooting stars (subtle, not too frequent)
    nextSpawnIn--;
    if (nextSpawnIn <= 0 && shootingStars.length < 2) {
      shootingStars.push(makeShootingStar());
      nextSpawnIn = 35 + Math.random() * 90;
    }

    // draw + update shooting stars — thin, subtle, short glowing trail with fade in/out
    shootingStars.forEach(sh => {
      if (sh.delay > 0) { sh.delay--; return; }

      const progress = sh.life / sh.maxLife;
      let fade;
      if (progress < 0.18) fade = progress / 0.18;
      else if (progress > 0.65) fade = Math.max(0, (1 - progress) / 0.35);
      else fade = 1;

      const alpha = fade * 0.75;

      const tailX = sh.x - sh.vx * 2.8;
      const tailY = sh.y - sh.vy * 2.8;

      const grad = ctx.createLinearGradient(sh.x, sh.y, tailX, tailY);
      grad.addColorStop(0, `rgba(255,255,255,${alpha})`);
      grad.addColorStop(1, "rgba(255,255,255,0)");

      ctx.beginPath();
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.4;
      ctx.moveTo(sh.x, sh.y);
      ctx.lineTo(tailX, tailY);
      ctx.stroke();

      sh.x += sh.vx;
      sh.y += sh.vy;
      sh.life++;
    });

    shootingStars = shootingStars.filter(sh => sh.life < sh.maxLife && sh.x > -60 && sh.x < width + 60 && sh.y < height + 60);

    requestAnimationFrame(tick);
  }

  tick();
  window.addEventListener("resize", () => { resize(); makeStars(); });
})();

// ==========================================
// ACTIVE NAV HIGHLIGHT (on scroll)
// ==========================================
(function () {
  const sections = document.querySelectorAll("header[id], section[id]");
  const navLinks = document.querySelectorAll(".navbar .nav-links a");
  if (!sections.length || !navLinks.length) return;

  const linkMap = {};
  navLinks.forEach(link => {
    const id = (link.getAttribute("href") || "").replace("#", "");
    if (id) linkMap[id] = link;
  });

  const navObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      const link = linkMap[entry.target.id];
      if (!link) return;
      if (entry.isIntersecting) {
        navLinks.forEach(l => l.classList.remove("nav-active"));
        link.classList.add("nav-active");
      }
    });
  }, { rootMargin: "-45% 0px -45% 0px" });

  sections.forEach(sec => navObserver.observe(sec));
})();

// ==========================================
// BACK TO TOP BUTTON
// ==========================================
(function () {
  const btn = document.getElementById("backToTop");
  if (!btn) return;
  window.addEventListener("scroll", () => {
    btn.classList.toggle("is-visible", window.scrollY > 500);
  });
  btn.addEventListener("click", () => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
})();

// ==========================================
// MOBILE NAV TOGGLE
// ==========================================
document.getElementById("navToggle").addEventListener("click", () => {
  document.querySelector(".nav-left").classList.toggle("open");
  document.querySelector(".nav-right").classList.toggle("open");
});
document.getElementById("year").textContent = new Date().getFullYear();

// ==========================================
// DARK / LIGHT THEME TOGGLE
// ==========================================
(function () {
  const btn = document.getElementById("themeToggle");
  if (!btn) return;

  function syncIcon() {
    const isLight = document.body.classList.contains("light-theme");
    btn.textContent = isLight ? "☀️" : "🌙";
  }

  syncIcon();

  btn.addEventListener("click", () => {
    document.body.classList.toggle("light-theme");
    const isLight = document.body.classList.contains("light-theme");
    try { localStorage.setItem("theme", isLight ? "light" : "dark"); } catch (e) {}
    syncIcon();
  });
})();

function esc(str) {
  if (!str) return "";
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}
function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

// ==========================================
// HERO PHOTO SLIDESHOW (2 photos, crossfade + dots)
// ==========================================
function setupHeroSlideshow(photo1Url, photo2Url) {
  const img1 = document.getElementById("heroPhoto1");
  const img2 = document.getElementById("heroPhoto2");
  const dots = document.querySelectorAll("#slideDots span");

  const urls = [photo1Url, photo2Url].filter(Boolean);
  if (urls.length === 0) return;

  [img1, img2].forEach(img => {
    img.addEventListener("error", () => { img.style.display = "none"; });
  });

  img1.src = urls[0];
  img2.src = urls[1] || urls[0];

  if (urls.length < 2) {
    // only one photo available — no slideshow, just show it
    dots.forEach(d => d.style.display = "none");
    return;
  }

  const images = [img1, img2];
  let active = 0;

  setInterval(() => {
    images[active].classList.remove("is-active");
    dots[active].classList.remove("is-active");
    active = (active + 1) % 2;
    images[active].classList.add("is-active");
    dots[active].classList.add("is-active");
  }, 4000);
}

// ==========================================
// PROFILE (hero + about text, driven by admin)
// ==========================================
async function loadProfile() {
  const { data, error } = await supabaseClient.from("profile").select("*").limit(1).single();

  if (error || !data) return;

  if (data.hero_heading) document.getElementById("heroHeading").textContent = data.hero_heading;
  if (data.hero_subheading) document.getElementById("heroSubheading").textContent = data.hero_subheading;

  setupHeroSlideshow(data.hero_photo_url, data.about_photo_url);

  if (data.about_heading) document.getElementById("aboutHeading").textContent = data.about_heading;
  const aboutPhotoEl = document.getElementById("aboutPhoto");
  if (aboutPhotoEl && data.about_photo_url) aboutPhotoEl.src = data.about_photo_url;

  if (data.about_paragraphs) {
    const paras = data.about_paragraphs.split("\n").filter(p => p.trim());
    document.getElementById("aboutParagraphs").innerHTML = paras.map(p => `<p>${esc(p)}</p>`).join("");
  }

  if (data.resume_url) {
    const btn = document.getElementById("resumeBtn");
    btn.href = data.resume_url;
    btn.style.display = "inline-block";
  }

  if (data.full_name) {
    document.title = data.full_name + " — Portfolio";
    document.getElementById("navLogo").innerHTML = `${esc(data.full_name)}`;
    document.getElementById("footerLogo").innerHTML = `${esc(data.full_name)}`;
    document.getElementById("footerName").textContent = data.full_name;
  }
  const footerTaglineText = data.professional_title || data.tagline;
  if (footerTaglineText) document.getElementById("footerTagline").textContent = footerTaglineText;
}

// ==========================================
// SKILL CATEGORIES
// ==========================================
async function loadSkills() {
  const el = document.getElementById("skillsGrid");
  const { data, error } = await supabaseClient.from("skill_categories").select("*").order("sort_order");

  if (error || !data || data.length === 0) {
    el.innerHTML = `<p class="loading-text">No skills added yet.</p>`;
    return;
  }

  el.innerHTML = data.map((s, i) => `
    <div class="skill-card reveal" style="transition-delay:${i * 80}ms">
      <div class="skill-card-head">
        <h4>${esc(s.name)}</h4>
        <span class="skill-percent-inline">${s.proficiency || 0}%</span>
      </div>
      <div class="skill-bar"><div class="skill-bar-fill" style="width:${s.proficiency || 0}%"></div></div>
      <p>${esc(s.skills_list)}</p>
    </div>
  `).join("");
  observeReveals(el);
}

// ==========================================
// PROJECTS
// ==========================================
let projectsCache = [];

async function loadProjects() {
  const el = document.getElementById("projectsGrid");
  const { data, error } = await supabaseClient.from("projects").select("*").order("created_at", { ascending: false });

  if (error || !data || data.length === 0) {
    el.innerHTML = `<p class="loading-text">No projects added yet.</p>`;
    return;
  }

  projectsCache = data;

  el.innerHTML = data.map((p, i) => `
    <div class="card reveal" style="transition-delay:${i * 80}ms">
      ${p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.title)}" loading="lazy" />` : ""}
      <div class="card-body">
        <h3>${esc(p.title)}</h3>
        <p class="card-desc">${esc(p.description)}</p>
        <button class="card-more-btn" data-index="${i}">Read more →</button>
        <div class="card-bottom">
          ${p.tech_stack && p.tech_stack.length ? `<div class="tag-row">${p.tech_stack.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
          <div class="card-links">
            ${p.project_link ? `<a href="${esc(p.project_link)}" target="_blank" rel="noopener">Live →</a>` : ""}
            ${p.github_link ? `<a href="${esc(p.github_link)}" target="_blank" rel="noopener">GitHub →</a>` : ""}
          </div>
        </div>
      </div>
    </div>
  `).join("");

  el.querySelectorAll(".card-more-btn").forEach(btn => {
    btn.addEventListener("click", () => openProjectModal(projectsCache[Number(btn.dataset.index)]));
  });

  observeReveals(el);
}

// ==========================================
// PROJECT DETAIL MODAL
// ==========================================
function openProjectModal(p) {
  const backdrop = document.getElementById("pmodalBackdrop");
  const content = document.getElementById("pmodalContent");

  content.innerHTML = `
    ${p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.title)}" loading="lazy" />` : ""}
    <div class="pmodal-body">
      <h3>${esc(p.title)}</h3>
      <p>${esc(p.description)}</p>
      ${p.tech_stack && p.tech_stack.length ? `<div class="tag-row">${p.tech_stack.map(t => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
      <div class="card-links" style="margin-top:1rem;">
        ${p.project_link ? `<a href="${esc(p.project_link)}" target="_blank" rel="noopener">Live →</a>` : ""}
        ${p.github_link ? `<a href="${esc(p.github_link)}" target="_blank" rel="noopener">GitHub →</a>` : ""}
      </div>
    </div>
  `;
  backdrop.classList.add("is-open");
}

function closeProjectModal() {
  document.getElementById("pmodalBackdrop").classList.remove("is-open");
}

document.getElementById("pmodalClose").addEventListener("click", closeProjectModal);
document.getElementById("pmodalBackdrop").addEventListener("click", (e) => {
  if (e.target.id === "pmodalBackdrop") closeProjectModal();
});

// ==========================================
// EXPERIENCE
// ==========================================
async function loadExperience() {
  const el = document.getElementById("experienceTimeline");
  const { data, error } = await supabaseClient.from("experience").select("*").order("start_date", { ascending: false });
  if (error || !data || data.length === 0) { el.innerHTML = `<p class="loading-text">No experience added yet.</p>`; return; }
  el.innerHTML = data.map((e, i) => `
    <div class="timeline-item reveal" style="transition-delay:${i * 80}ms">
      <h3>${esc(e.company)}</h3>
      <p class="role">${esc(e.role)}</p>
      <p class="dates">${formatDate(e.start_date)} — ${e.is_current ? "Present" : formatDate(e.end_date)}</p>
      <p>${esc(e.description)}</p>
    </div>
  `).join("");
  observeReveals(el);
}

// ==========================================
// EDUCATION
// ==========================================
async function loadEducation() {
  const el = document.getElementById("educationTimeline");
  const { data, error } = await supabaseClient.from("education").select("*").order("start_date", { ascending: false });
  if (error || !data || data.length === 0) { el.innerHTML = `<p class="loading-text">No education added yet.</p>`; return; }
  el.innerHTML = data.map((ed, i) => `
    <div class="timeline-item reveal" style="transition-delay:${i * 80}ms">
      <h3>${esc(ed.institution)}</h3>
      <p class="role">${esc(ed.degree)}${ed.field_of_study ? " — " + esc(ed.field_of_study) : ""}</p>
      <p class="dates">${formatDate(ed.start_date)} — ${formatDate(ed.end_date) || "Present"}</p>
      <p>${esc(ed.description)}</p>
    </div>
  `).join("");
  observeReveals(el);
}

// ==========================================
// CERTIFICATIONS
// ==========================================
async function loadCertifications() {
  const el = document.getElementById("certsGrid");
  const { data, error } = await supabaseClient.from("certifications").select("*").order("issue_date", { ascending: false });
  if (error || !data || data.length === 0) { el.innerHTML = `<p class="loading-text">No certifications added yet.</p>`; return; }
  el.innerHTML = data.map((c, i) => {
    // Admin's "Verification URL" field may be saved as verification_url or credential_url depending on schema — support both
    const link = c.verification_url || c.credential_url || c.credential_link || "";
    const openUrl = link || c.image_url || "";
    const wrapStart = openUrl ? `<a href="${esc(openUrl)}" target="_blank" rel="noopener" class="card cert-card reveal"` : `<div class="card cert-card reveal"`;
    const wrapEnd = openUrl ? `</a>` : `</div>`;
    return `
    ${wrapStart} style="transition-delay:${i * 80}ms">
      ${c.image_url ? `<img src="${esc(c.image_url)}" alt="${esc(c.title)}" loading="lazy" />` : ""}
      <div class="card-body">
        <h3>${esc(c.title)}</h3>
        <p>${esc(c.issued_by)} · ${formatDate(c.issue_date)}</p>
        ${c.credential_id ? `<p class="cert-id">ID: ${esc(c.credential_id)}</p>` : ""}
        ${link ? `<div class="card-links"><span>View Credential →</span></div>` : (c.image_url ? `<div class="card-links"><span>View Certificate →</span></div>` : "")}
      </div>
    ${wrapEnd}
  `;
  }).join("");
  observeReveals(el);
}

// ==========================================
// TESTIMONIALS
// ==========================================
async function loadTestimonials() {
  const el = document.getElementById("testimonialsGrid");
  const { data, error } = await supabaseClient.from("testimonials").select("*").order("created_at", { ascending: false });
  if (error || !data || data.length === 0) { el.innerHTML = `<p class="loading-text">No testimonials yet.</p>`; return; }
  const stars = (n) => {
    const filled = Math.max(0, Math.min(5, n || 5));
    return `<span class="testimonial-stars">${"★".repeat(filled)}${"☆".repeat(5 - filled)}</span>`;
  };

  el.innerHTML = data.map((t, i) => `
    <div class="testimonial-card reveal" style="transition-delay:${i * 80}ms">
      <div class="testimonial-content">
        ${stars(t.rating)}
        <p class="testimonial-quote">"${esc(t.message)}"</p>
        <h3>${esc(t.name)}</h3>
        <p class="testimonial-role">${esc(t.designation)}</p>
      </div>
      ${t.image_url ? `
        <div class="testimonial-photo-wrap">
          <img src="${esc(t.image_url)}" alt="${esc(t.name)}" class="testimonial-photo" loading="lazy" />
        </div>
      ` : ""}
    </div>
  `).join("");
  observeReveals(el);
}

// ==========================================
// SOCIAL LINKS
// ==========================================
const SOCIAL_ICONS = {
  github: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.48 2 2 6.58 2 12.25c0 4.53 2.87 8.37 6.84 9.73.5.1.68-.22.68-.49 0-.24-.01-.87-.01-1.71-2.78.62-3.37-1.37-3.37-1.37-.45-1.18-1.11-1.5-1.11-1.5-.91-.64.07-.63.07-.63 1 .07 1.53 1.06 1.53 1.06.89 1.56 2.34 1.11 2.91.85.09-.66.35-1.11.63-1.37-2.22-.26-4.56-1.14-4.56-5.07 0-1.12.39-2.03 1.03-2.75-.1-.26-.45-1.31.1-2.73 0 0 .84-.28 2.75 1.05a9.3 9.3 0 0 1 5 0c1.91-1.33 2.75-1.05 2.75-1.05.55 1.42.2 2.47.1 2.73.64.72 1.03 1.63 1.03 2.75 0 3.94-2.34 4.8-4.57 5.06.36.32.68.94.68 1.9 0 1.37-.01 2.47-.01 2.81 0 .27.18.6.69.49A10.26 10.26 0 0 0 22 12.25C22 6.58 17.52 2 12 2Z"/></svg>`,
  linkedin: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6.94 5a2 2 0 1 1-3.88 0 2 2 0 0 1 3.88 0ZM3.5 8.75h3.5V21H3.5V8.75Zm6 0h3.35v1.6h.05c.47-.88 1.6-1.85 3.3-1.85 3.53 0 4.18 2.32 4.18 5.34V21h-3.5v-5.5c0-1.3-.02-3-1.82-3-1.82 0-2.1 1.4-2.1 2.87V21H9.5V8.75Z"/></svg>`,
  email: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/></svg>`,
  twitter: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18.9 2h3.1l-6.8 7.8L23 22h-6.3l-4.9-6.4L6.2 22H3.1l7.3-8.3L2 2h6.4l4.5 5.9L18.9 2Zm-1.1 18h1.7L7.3 3.9H5.5L17.8 20Z"/></svg>`,
  instagram: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.2" cy="6.8" r="1"/></svg>`,
  facebook: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 22v-8.5H16l.4-3.3h-2.9V8.1c0-1 .3-1.6 1.7-1.6H16.5V3.5c-.3 0-1.4-.1-2.6-.1-2.6 0-4.4 1.6-4.4 4.5v2.3H6.9v3.3h2.6V22h4Z"/></svg>`,
  website: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>`,
  default: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5"/><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5"/></svg>`,
};

function normalizePlatform(platform) {
  const p = (platform || "").trim().toLowerCase().replace(/[\s._-]/g, "");
  if (p.includes("linkedin") || p.includes("linkdin") || p.includes("linked")) return "linkedin";
  if (p.includes("github")) return "github";
  if (p.includes("email") || p.includes("gmail") || p.includes("mail")) return "email";
  if (p.includes("twitter") || p === "x") return "twitter";
  if (p.includes("instagram") || p.includes("insta")) return "instagram";
  if (p.includes("facebook") || p.includes("fb")) return "facebook";
  if (p.includes("website") || p.includes("portfolio") || p.includes("web")) return "website";
  return p;
}

function iconFor(platform, iconUrl) {
  if (iconUrl && iconUrl.trim()) {
    // Admin provided a custom icon image URL -> use it directly, no code changes ever needed
    return `<img src="${esc(iconUrl.trim())}" alt="" class="social-icon-img" />`;
  }
  const p = normalizePlatform(platform);
  return SOCIAL_ICONS[p] || SOCIAL_ICONS.default;
}

function toSocialHref(platform, url) {
  const isEmailPlatform = normalizePlatform(platform) === "email";
  const trimmedUrl = (url || "").trim();
  const looksLikeBareEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedUrl);

  if ((isEmailPlatform || looksLikeBareEmail) && !trimmedUrl.startsWith("http") && !trimmedUrl.startsWith("mailto:")) {
    // bare email address -> mailto: opens the device's default mail app (desktop + mobile)
    return `mailto:${trimmedUrl}`;
  }
  return trimmedUrl;
}

async function loadSocialLinks() {
  const { data, error } = await supabaseClient.from("social_links").select("*");
  if (error || !data || data.length === 0) return;

  const html = data.map(s => {
    const href = toSocialHref(s.platform, s.url);
    const p = normalizePlatform(s.platform);
    const platformClass = SOCIAL_ICONS[p] ? `platform-${p}` : "";
    return `<a class="${platformClass}" href="${esc(href)}" target="_blank" rel="noopener" title="${esc(s.platform)}" aria-label="${esc(s.platform)}">${iconFor(s.platform, s.icon_url)}</a>`;
  }).join("");

  const footerEl = document.getElementById("socialLinks");
  const contactEl = document.getElementById("socialLinksContact");
  if (footerEl) footerEl.innerHTML = html;
  if (contactEl) contactEl.innerHTML = html;
}

// ==========================================
// CONTACT FORM
// ==========================================
document.getElementById("contactForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const form = e.target;
  const statusEl = document.getElementById("formStatus");

  if (form.website.value.trim() !== "") { form.reset(); statusEl.textContent = "Message sent — thank you!"; return; }

  const name = form.name.value.trim();
  const email = form.email.value.trim();
  const message = form.message.value.trim();
  statusEl.textContent = "Sending…";

  const { error } = await supabaseClient.from("contact_messages").insert([{ name, email, message }]);
  if (error) { statusEl.textContent = "Something went wrong. Please try again."; console.error(error); return; }
  statusEl.textContent = "Message sent — thank you! I'll get back to you soon.";
  form.reset();
});

// ==========================================
// INIT
// ==========================================
loadProfile();
loadSkills();
loadProjects();
loadExperience();
loadEducation();
loadCertifications();
loadTestimonials();
loadSocialLinks();
observeReveals();