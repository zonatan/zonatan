/**
 * Generator kartu profil GitHub bertema "Volt Violet" (HUD / game interface).
 * Dijalankan oleh .github/workflows/profile.yml → hasilnya dipublikasikan ke branch `output`.
 *
 * Output (di folder dist/):
 *   header.svg     banner animasi dengan nama (font Teko → path, tidak butuh font terpasang)
 *   stats.svg      PLAYER STATS: level, XP, commit, PR, issue, bintang, repo
 *   streak.svg     total kontribusi, streak saat ini, streak terpanjang
 *   languages.svg  bahasa yang paling banyak dipakai di repo publik
 *
 * Lokal: GITHUB_TOKEN=$(gh auth token) GH_LOGIN=zonatan node scripts/build-cards.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import opentype from "opentype.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "dist");
const LOGIN = process.env.GH_LOGIN || "zonatan";
const TOKEN = process.env.GITHUB_TOKEN;
if (!TOKEN) throw new Error("GITHUB_TOKEN wajib diisi");

const C = {
  bg: "#08070d",
  surface: "#100e1a",
  raised: "#18152a",
  violet: "#8b5cf6",
  violetSoft: "#a78bfa",
  violetDim: "#5b3fb8",
  lime: "#c6ff3d",
  magenta: "#ff3d9a",
  ink: "#f1eefc",
  ink2: "#a9a3c4",
  ink3: "#847ea0",
};
const MONO = "'JetBrains Mono', 'SFMono-Regular', Consolas, 'Liberation Mono', monospace";
const SANS = "'Segoe UI', 'Helvetica Neue', Ubuntu, Arial, sans-serif";

const teko = opentype.loadSync(join(ROOT, "assets/fonts/teko-latin-700-normal.woff"));

/** Teks Teko sebagai <path> (tampil sama di semua perangkat). */
function tekoPath(text, x, y, size, fill, { anchor = "start", extra = "" } = {}) {
  const w = teko.getAdvanceWidth(text, size);
  const sx = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
  const d = teko.getPath(text, sx, y, size).toPathData(2);
  return `<path d="${d}" fill="${fill}" ${extra}/>`;
}
const tekoWidth = (text, size) => teko.getAdvanceWidth(text, size);
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmt = (n) => n.toLocaleString("en-US");

/* ------------------------------------------------------------------ data */

async function gql(query, variables = {}) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: { Authorization: `bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function fetchData() {
  const base = await gql(
    `query($login: String!) {
      user(login: $login) {
        name login avatarUrl createdAt
        followers { totalCount }
        pullRequests { totalCount }
        issues { totalCount }
        contributionsCollection { contributionYears }
        repositories(ownerAffiliations: OWNER, isFork: false, privacy: PUBLIC, first: 100) {
          totalCount
          nodes {
            stargazerCount
            languages(first: 10, orderBy: { field: SIZE, direction: DESC }) {
              edges { size node { name } }
            }
          }
        }
      }
    }`,
    { login: LOGIN },
  );
  const u = base.user;
  const years = u.contributionsCollection.contributionYears;

  // Satu query berisi semua tahun (alias y2024, y2025, ...)
  const parts = years
    .map(
      (y) => `y${y}: contributionsCollection(from: "${y}-01-01T00:00:00Z", to: "${y}-12-31T23:59:59Z") {
        totalCommitContributions
        contributionCalendar { totalContributions weeks { contributionDays { date contributionCount } } }
      }`,
    )
    .join("\n");
  const yearly = (await gql(`query($login: String!) { user(login: $login) { ${parts} } }`, { login: LOGIN })).user;

  let commits = 0;
  let total = 0;
  const days = [];
  for (const y of years) {
    const c = yearly[`y${y}`];
    commits += c.totalCommitContributions;
    total += c.contributionCalendar.totalContributions;
    for (const w of c.contributionCalendar.weeks) days.push(...w.contributionDays);
  }
  days.sort((a, b) => a.date.localeCompare(b.date));

  const langs = new Map();
  let stars = 0;
  for (const r of u.repositories.nodes) {
    stars += r.stargazerCount;
    for (const e of r.languages.edges) langs.set(e.node.name, (langs.get(e.node.name) ?? 0) + e.size);
  }

  return {
    name: u.name || u.login,
    login: u.login,
    createdAt: u.createdAt,
    followers: u.followers.totalCount,
    prs: u.pullRequests.totalCount,
    issues: u.issues.totalCount,
    repos: u.repositories.totalCount,
    stars,
    commits,
    total,
    days,
    langs: [...langs.entries()].sort((a, b) => b[1] - a[1]),
  };
}

function streaks(days) {
  const today = new Date().toISOString().slice(0, 10);
  const past = days.filter((d) => d.date <= today);
  let longest = { len: 0, from: null, to: null };
  let run = { len: 0, from: null };
  for (const d of past) {
    if (d.contributionCount > 0) {
      if (run.len === 0) run.from = d.date;
      run.len += 1;
      if (run.len > longest.len) longest = { len: run.len, from: run.from, to: d.date };
    } else run = { len: 0, from: null };
  }
  // Streak saat ini: hari ini boleh masih 0 (belum berkontribusi), mulai hitung dari kemarin
  let i = past.length - 1;
  if (i >= 0 && past[i].contributionCount === 0) i -= 1;
  let cur = 0;
  let curFrom = null;
  for (; i >= 0 && past[i].contributionCount > 0; i--) {
    cur += 1;
    curFrom = past[i].date;
  }
  return { current: cur, currentFrom: curFrom, longest };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const shortDate = (iso, withYear = true) => {
  if (!iso) return "-";
  const [y, m, d] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}${withYear ? `, ${y}` : ""}`;
};

/* ------------------------------------------------------------------ svg helpers */

/** Bingkai HUD: panel bersudut potong, garis berjalan, dan bracket lime di sudut. */
function frame(w, h, { cut = 16, title, tag } = {}) {
  const p = `M${cut} 1 H${w - 1} V${h - cut} L${w - cut} ${h - 1} H1 V${cut} Z`;
  const per = 2 * (w + h);
  const br = (x, y, dx, dy) =>
    `<path d="M${x} ${y + dy * 14} V${y} H${x + dx * 14}" stroke="${C.lime}" stroke-width="2" fill="none"/>`;
  return `
  <defs>
    <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.raised}"/>
      <stop offset="1" stop-color="${C.surface}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.85" cy="0" r="0.9">
      <stop offset="0" stop-color="${C.violet}" stop-opacity="0.22"/>
      <stop offset="1" stop-color="${C.violet}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <path d="${p}" fill="url(#panel)"/>
  <path d="${p}" fill="url(#glow)"/>
  <path d="${p}" fill="none" stroke="${C.violetDim}" stroke-opacity="0.7"/>
  <path class="beam" d="${p}" fill="none" stroke="${C.lime}" stroke-width="1.5"
        stroke-dasharray="90 ${per}" stroke-linecap="round"/>
  ${br(6, 6, 1, 1)}${br(w - 6, 6, -1, 1)}
  ${title ? `<text x="24" y="34" font-family="${MONO}" font-size="12" letter-spacing="2.4" fill="${C.lime}" font-weight="700">${esc(title)}</text>` : ""}
  ${tag ? `<text x="${w - 24}" y="34" text-anchor="end" font-family="${MONO}" font-size="11" letter-spacing="2" fill="${C.ink3}">${esc(tag)}</text>` : ""}
  <path d="M24 46 H${w - 24}" stroke="${C.violetDim}" stroke-opacity="0.45"/>`;
}

/** CSS animasi umum. Keadaan dasar = keadaan akhir, jadi tetap tampil walau animasi mati. */
const baseStyle = (per) => `
  <style>
    .beam { animation: beam 6s linear infinite; }
    @keyframes beam { from { stroke-dashoffset: 0; } to { stroke-dashoffset: -${per}; } }
    .row { animation: rise .6s cubic-bezier(.22,1,.36,1) backwards; }
    @keyframes rise { from { opacity: 0; transform: translateY(8px); } }
    .grow { transform-box: fill-box; transform-origin: left center; animation: grow 1.1s cubic-bezier(.22,1,.36,1) backwards; }
    @keyframes grow { from { transform: scaleX(0); } }
    .blink { animation: blink 1.6s steps(2, start) infinite; }
    @keyframes blink { 50% { opacity: .15; } }
    .pulse { transform-box: fill-box; transform-origin: center; animation: pulse 2.4s ease-in-out infinite; }
    @keyframes pulse { 50% { transform: scale(1.08); } }
    @media (prefers-reduced-motion: reduce) { * { animation: none !important; } }
  </style>`;

/* ------------------------------------------------------------------ cards */

function headerSvg(d) {
  const W = 1200;
  const H = 320;
  const per = 2 * (W + H);
  const grid = [];
  for (let x = 0; x <= W; x += 48) grid.push(`M${x} 0V${H}`);
  for (let y = 0; y <= H; y += 48) grid.push(`M0 ${y}H${W}`);
  const first = "ZONATAN";
  const second = "SIHOMBING";
  // Ukuran nama menyesuaikan agar tidak menabrak emblem di kanan (lebar maks ~820px)
  const GAP = 22;
  const nameSize = Math.min(118, (118 * 820) / (tekoWidth(first, 118) + GAP + tekoWidth(second, 118)));
  const w1 = tekoWidth(first, nameSize);
  const since = new Date(d.createdAt).getUTCFullYear();

  // Emblem ZS heksagonal di kanan
  const ex = 1010;
  const ey = 160;
  const hex = Array.from({ length: 8 }, (_, i) => {
    const a = (Math.PI / 4) * i + Math.PI / 8;
    return `${(ex + Math.cos(a) * 92).toFixed(1)},${(ey + Math.sin(a) * 92).toFixed(1)}`;
  }).join(" ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(d.name)} — Web Developer &amp; Computer Vision">
  ${baseStyle(per)}
  <style>
    .scan { animation: scan 5s ease-in-out infinite; }
    @keyframes scan { 0%, 100% { transform: translateY(-40px); opacity: 0; } 10% { opacity: .9; } 50% { transform: translateY(${H}px); opacity: .9; } 60% { opacity: 0; } }
    .spin { transform-origin: ${ex}px ${ey}px; animation: spin 18s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .n1 { animation: rise .8s cubic-bezier(.22,1,.36,1) .1s backwards; }
    .n2 { animation: rise .8s cubic-bezier(.22,1,.36,1) .3s backwards; }
    .n3 { animation: rise .8s cubic-bezier(.22,1,.36,1) .5s backwards; }
  </style>
  <defs>
    <radialGradient id="hg" cx="0.82" cy="0.3" r="0.7">
      <stop offset="0" stop-color="${C.violet}" stop-opacity="0.35"/>
      <stop offset="1" stop-color="${C.violet}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="hg2" cx="0.05" cy="1" r="0.6">
      <stop offset="0" stop-color="${C.lime}" stop-opacity="0.10"/>
      <stop offset="1" stop-color="${C.lime}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="scanl" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${C.lime}" stop-opacity="0"/>
      <stop offset="1" stop-color="${C.lime}" stop-opacity="0.35"/>
    </linearGradient>
    <clipPath id="clip"><rect width="${W}" height="${H}" rx="14"/></clipPath>
  </defs>
  <g clip-path="url(#clip)">
    <rect width="${W}" height="${H}" fill="${C.bg}"/>
    <path d="${grid.join("")}" stroke="${C.violetDim}" stroke-opacity="0.18"/>
    <rect width="${W}" height="${H}" fill="url(#hg)"/>
    <rect width="${W}" height="${H}" fill="url(#hg2)"/>
    <rect class="scan" x="0" y="0" width="${W}" height="40" fill="url(#scanl)" opacity="0"/>
  </g>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="none" stroke="${C.violetDim}" stroke-opacity="0.6"/>
  <rect class="beam" x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="14" fill="none" stroke="${C.lime}" stroke-width="2" stroke-dasharray="160 ${per}"/>

  <g class="n1">
    <text x="64" y="70" font-family="${MONO}" font-size="16" letter-spacing="4" fill="${C.lime}" font-weight="700">PLAYER ENTRY // ZS-01 · MANADO, ID</text>
  </g>
  <g class="n2">
    ${tekoPath(first, 60, 178, nameSize, C.ink)}
    ${tekoPath(second, 60 + w1 + GAP, 178, nameSize, C.violetSoft)}
  </g>
  <g class="n3">
    <text x="64" y="222" font-family="${SANS}" font-size="24" fill="${C.ink2}">Web Developer · Computer Vision · Server · AI Integration</text>
    <rect x="64" y="246" width="176" height="36" fill="${C.lime}"/>
    <circle class="blink" cx="84" cy="264" r="5" fill="${C.bg}"/>
    <text x="98" y="270" font-family="${MONO}" font-size="14" letter-spacing="3" fill="${C.bg}" font-weight="700">OPEN TO WORK</text>
    <text x="262" y="270" font-family="${MONO}" font-size="14" letter-spacing="2" fill="${C.ink3}">UNIMA · INFORMATICS · ON GITHUB SINCE ${since}</text>
  </g>

  <g class="spin">
    <polygon points="${hex}" fill="none" stroke="${C.violet}" stroke-opacity="0.5" stroke-width="2" stroke-dasharray="14 10"/>
  </g>
  <polygon points="${Array.from({ length: 8 }, (_, i) => {
    const a = (Math.PI / 4) * i + Math.PI / 8;
    return `${(ex + Math.cos(a) * 70).toFixed(1)},${(ey + Math.sin(a) * 70).toFixed(1)}`;
  }).join(" ")}" fill="${C.raised}" stroke="${C.violetSoft}" stroke-width="2.5"/>
  ${tekoPath("Z", ex - 4, ey + 30, 92, C.lime, { anchor: "end" })}
  ${tekoPath("S", ex - 2, ey + 30, 92, C.violetSoft)}
</svg>`;
}

function statsSvg(d, s) {
  const W = 480;
  const H = 230;
  const per = 2 * (W + H);
  // Level ala game dari aktivitas
  const xp = d.total * 2 + d.prs * 10 + d.issues * 5 + d.stars * 15 + d.repos * 8;
  const level = Math.floor(Math.sqrt(xp / 12)) + 1;
  const lvlBase = 12 * (level - 1) ** 2;
  const lvlNext = 12 * level ** 2;
  const prog = Math.min(1, (xp - lvlBase) / (lvlNext - lvlBase));

  const rows = [
    ["COMMITS", fmt(d.commits)],
    ["PULL REQUESTS", fmt(d.prs)],
    ["ISSUES", fmt(d.issues)],
    ["STARS EARNED", fmt(d.stars)],
    ["PUBLIC REPOS", fmt(d.repos)],
  ];
  const rowSvg = rows
    .map(
      ([k, v], i) => `<g class="row" style="animation-delay:${0.15 + i * 0.1}s">
      <rect x="24" y="${66 + i * 30}" width="3" height="16" fill="${i === 0 ? C.lime : C.violetSoft}"/>
      <text x="38" y="${79 + i * 30}" font-family="${MONO}" font-size="12" letter-spacing="1.6" fill="${C.ink2}">${k}</text>
      <text x="270" y="${80 + i * 30}" text-anchor="end" font-family="${MONO}" font-size="15" font-weight="700" fill="${C.ink}">${v}</text>
    </g>`,
    )
    .join("");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="GitHub stats">
  ${baseStyle(per)}
  ${frame(W, H, { title: "PLAYER STATS", tag: `@${d.login}` })}
  ${rowSvg}
  <g class="pulse">
    <circle cx="380" cy="128" r="64" fill="none" stroke="${C.violetDim}" stroke-width="6" stroke-opacity="0.5"/>
  </g>
  <circle cx="380" cy="128" r="64" fill="none" stroke="${C.lime}" stroke-width="6" stroke-linecap="round"
    stroke-dasharray="${(2 * Math.PI * 64 * prog).toFixed(1)} 999" transform="rotate(-90 380 128)"/>
  <text x="380" y="104" text-anchor="middle" font-family="${MONO}" font-size="11" letter-spacing="2.4" fill="${C.ink3}">LEVEL</text>
  ${tekoPath(String(level), 380, 160, 64, C.ink, { anchor: "middle" })}
  <text x="380" y="214" text-anchor="middle" font-family="${MONO}" font-size="11" letter-spacing="1.5" fill="${C.ink3}">XP ${fmt(xp)} / ${fmt(lvlNext)}</text>
</svg>`;
}

function streakSvg(d, s) {
  const W = 480;
  const H = 230;
  const per = 2 * (W + H);
  const col = (cx, label, value, sub, color, big = false) => `
    ${tekoPath(String(value), cx, big ? 132 : 134, big ? 60 : 52, color, { anchor: "middle" })}
    <text x="${cx}" y="${big ? 180 : 168}" text-anchor="middle" font-family="${MONO}" font-size="11" letter-spacing="2" fill="${big ? C.lime : C.ink2}" font-weight="700">${label}</text>
    <text x="${cx}" y="${big ? 200 : 188}" text-anchor="middle" font-family="${MONO}" font-size="10.5" fill="${C.ink3}">${esc(sub)}</text>`;
  const curSub = s.current > 0 ? `${shortDate(s.currentFrom, false)} – now` : "start a new run";
  const longSub = s.longest.len
    ? `${shortDate(s.longest.from, false)} – ${shortDate(s.longest.to)}`
    : "-";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="GitHub streak">
  ${baseStyle(per)}
  ${frame(W, H, { title: "STREAK", tag: "DAILY" })}
  <path d="M168 66 V204 M312 66 V204" stroke="${C.violetDim}" stroke-opacity="0.45"/>
  <g class="row" style="animation-delay:.15s">${col(90, "CONTRIBUTIONS", fmt(d.total), `since ${shortDate(d.createdAt.slice(0, 10))}`, C.violetSoft)}</g>
  <g class="row" style="animation-delay:.3s">
    <g class="pulse"><circle cx="240" cy="111" r="45" fill="none" stroke="${s.current > 0 ? C.lime : C.violetDim}" stroke-width="3" stroke-opacity="0.8"/></g>
    ${col(240, "CURRENT STREAK", s.current, curSub, C.ink, true)}
  </g>
  <g class="row" style="animation-delay:.45s">${col(390, "LONGEST STREAK", s.longest.len, longSub, C.magenta)}</g>
</svg>`;
}

function languagesSvg(d) {
  const W = 480;
  const H = 230;
  const per = 2 * (W + H);
  const top = d.langs.slice(0, 6);
  const sum = top.reduce((n, [, v]) => n + v, 0) || 1;
  const palette = [C.lime, C.violetSoft, C.magenta, "#3dd6ff", "#ffc53d", C.ink2];
  // Bar bertumpuk
  let x = 24;
  const barW = W - 48;
  const stack = top
    .map(([, v], i) => {
      const w = (v / sum) * barW;
      const r = `<rect class="grow" style="animation-delay:${0.1 + i * 0.08}s" x="${x.toFixed(1)}" y="64" width="${Math.max(0, w - 2).toFixed(1)}" height="10" fill="${palette[i]}"/>`;
      x += w;
      return r;
    })
    .join("");
  const list = top
    .map(([name, v], i) => {
      const cx = i % 2 === 0 ? 24 : 252;
      const cy = 108 + Math.floor(i / 2) * 36;
      const pct = ((v / sum) * 100).toFixed(1);
      return `<g class="row" style="animation-delay:${0.3 + i * 0.08}s">
        <rect x="${cx}" y="${cy - 10}" width="10" height="10" fill="${palette[i]}"/>
        <text x="${cx + 20}" y="${cy}" font-family="${MONO}" font-size="13" fill="${C.ink}">${esc(name)}</text>
        <text x="${cx + 204}" y="${cy}" text-anchor="end" font-family="${MONO}" font-size="12" fill="${C.ink3}">${pct}%</text>
      </g>`;
    })
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Top languages">
  ${baseStyle(per)}
  ${frame(W, H, { title: "LOADOUT // LANGUAGES", tag: "TOP 6" })}
  ${stack}
  ${list}
</svg>`;
}

/* ------------------------------------------------------------------ main */

const data = await fetchData();
const s = streaks(data.days);
mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "header.svg"), headerSvg(data));
writeFileSync(join(OUT, "stats.svg"), statsSvg(data, s));
writeFileSync(join(OUT, "streak.svg"), streakSvg(data, s));
writeFileSync(join(OUT, "languages.svg"), languagesSvg(data));
console.log(
  `OK — ${data.login}: ${data.total} kontribusi, ${data.commits} commit, ${data.prs} PR, streak ${s.current} (terpanjang ${s.longest.len}), ${data.langs.length} bahasa`,
);
