// InstantNews bot v2 — FinancialJuice RSS -> Telegram (@FastestNewsFeed) + X (@InstantNews73)
// One file, Bun runtime (Railway Function). Built for speed: Telegram first, AI only where it adds value.

import { createHmac, randomBytes } from "node:crypto";
import { SQL } from "bun";
import { TelegramClient } from "@mtcute/bun";
import { MemoryStorage } from "@mtcute/core";

// ---------------------------------------------------------------- config
const E = Bun.env;
const FEED_URL = E.FEED_URL || "https://www.financialjuice.com/feed.ashx?xy=rss";
const POLL_MS = Number(E.POLL_MS || 4000); // target poll interval; backs off automatically on 429
const MAX_AGE_MIN = Number(E.MAX_AGE_MIN || 15); // older items (recycled/old news) are ignored
const clean = (v?: string) => String(v || "").trim().replace(/^["']|["']$/g, ""); // pasted secrets often carry spaces or quotes
const TG_TOKEN = clean(E.TG_TOKEN);
const TG_CHAT = E.TG_CHAT || "@FastestNewsFeed";
const X_KEY = clean(E.X_API_KEY), X_SECRET = clean(E.X_API_SECRET);
const X_TOKEN = clean(E.X_ACCESS_TOKEN), X_TOKEN_SECRET = clean(E.X_ACCESS_SECRET);
// shape check without revealing anything: lengths and whether the access token starts with the account's numeric id
const X_KEYS_SHAPE = { apiKeyLen: X_KEY.length, apiSecretLen: X_SECRET.length, accessTokenLen: X_TOKEN.length, accessTokenLooksOk: /^\d+-[A-Za-z0-9]+$/.test(X_TOKEN), accessSecretLen: X_TOKEN_SECRET.length };
const X_MODE = (E.X_MODE || "important").toLowerCase(); // important | all | off
const X_DAILY_CAP = Number(E.X_DAILY_CAP || 40);
const ANTHROPIC_KEY = clean(E.ANTHROPIC_API_KEY);
const MODELS_FAST = (E.ANTHROPIC_MODEL || "claude-haiku-5-5,claude-haiku-4-5").split(",").map((x) => x.trim());
const MODELS_SMART = (E.ANTHROPIC_MODEL_SMART || "claude-sonnet-5-5,claude-sonnet-4-5").split(",").map((x) => x.trim());
const FED_RSS = E.FED_RSS || "https://www.federalreserve.gov/feeds/press_monetary.xml";
const DRY_RUN = E.DRY_RUN === "1"; // log instead of posting
const ADMIN_TOKEN = E.ADMIN_TOKEN || "";
const TZ = "Europe/Bratislava";
const DIGEST_TIME = E.DIGEST_TIME || "22:00";
const CALENDAR_TIME = E.CALENDAR_TIME || "13:30";
const WEEKLY_TIME = E.WEEKLY_TIME || "19:00"; // Sunday NQ week-ahead
const BACKUP_TIME = E.BACKUP_TIME || "18:00"; // Sunday backup to admin chat
const IMG = {
  MOO: E.IMG_MOO || "https://i.postimg.cc/t4WD3bkz/MOO.png",
  MOC: E.IMG_MOC || "https://i.postimg.cc/3RJBQvTd/MOC.png",
  DIGEST: E.IMG_DIGEST || "https://i.postimg.cc/XJbB6Dnw/Chat-GPT-Image-12-5-2026-22-29-05.png",
};

const TG_API_ID = Number(String(E.TG_API_ID || 0).trim()), TG_API_HASH = String(E.TG_API_HASH || "").trim().replace(/^["']|["']$/g, "");
const TG_HASH_LOOKS_OK = /^[0-9a-f]{32}$/i.test(TG_API_HASH); // shown in status without revealing the hash
const TG_SOURCES = (E.TG_SOURCES || "").split(",").map((x) => x.trim().replace(/^@|^https?:\/\/t\.me\//g, "").toLowerCase()).filter(Boolean);
const xEnabled = X_MODE !== "off" && !!(X_KEY && X_SECRET && X_TOKEN && X_TOKEN_SECRET);
const log = (...a: any[]) => console.log(new Date().toISOString(), ...a);
const tmo = (ms: number) => AbortSignal.timeout(ms); // every network call has a time limit, so no loop can hang forever
process.on("unhandledRejection", (e) => log("unhandledRejection", String((e as any)?.stack || e)));
process.on("uncaughtException", (e) => log("uncaughtException", String(e?.stack || e)));
// On shutdown (redeploy) drop the Telegram user session at once, so the new container can take it over safely
let stopping = false;
const shutdown = async () => {
  if (stopping) return; stopping = true;
  log("shutting down");
  try { await (globalThis as any).__tgc?.close?.(); } catch {}
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
const health = {
  feedOkAt: Date.now(), lastPostAt: Date.now(),
  claudeFails: 0, claudeLastError: "",
  xLastError: "", xLastErrorAt: 0, xLastOkAt: 0,
  tgFails: 0, tgLastError: "",
};

// ---------------------------------------------------------------- storage
const db = E.DATABASE_URL ? new SQL(E.DATABASE_URL) : null;
const mem = { seen: new Set<string>(), headlines: [] as { day: string; title: string }[], kv: new Map<string, string>() };

async function dbInit() {
  if (!db) return log("No DATABASE_URL — using memory only");
  await db`CREATE TABLE IF NOT EXISTS seen (k text PRIMARY KEY, ts timestamptz DEFAULT now())`;
  await db`CREATE TABLE IF NOT EXISTS kv (k text PRIMARY KEY, v text)`;
  // same tables/shape as the old instantnews-api, so the website (instantnews24.net) keeps working
  await db`CREATE TABLE IF NOT EXISTS news (id serial PRIMARY KEY, headline text NOT NULL, content text, category text DEFAULT 'other', ticker text, high_alert boolean DEFAULT false, day text, created_at timestamptz DEFAULT now())`;
  await db`CREATE TABLE IF NOT EXISTS imbalances (id serial PRIMARY KEY, type text NOT NULL, sp500 bigint, nasdaq bigint, dow30 bigint, mag7 bigint, claude_analysis text, created_at timestamptz DEFAULT now())`;
  await db`CREATE TABLE IF NOT EXISTS digest (id serial PRIMARY KEY, content text NOT NULL, headlines text, created_at timestamptz DEFAULT now())`;
  await db`CREATE TABLE IF NOT EXISTS cftc (id serial PRIMARY KEY, week_ending date, data jsonb, claude_analysis text, created_at timestamptz DEFAULT now())`;
  await db`ALTER TABLE news ADD COLUMN IF NOT EXISTS day text`; // table may have been created by the old instantnews-api without it
  await db`ALTER TABLE news ADD COLUMN IF NOT EXISTS source text`;
  await db`ALTER TABLE news ADD COLUMN IF NOT EXISTS kind text`;
  await db`CREATE INDEX IF NOT EXISTS news_day_idx ON news (day)`;
  await db`CREATE TABLE IF NOT EXISTS weekly (id serial PRIMARY KEY, content text NOT NULL, created_at timestamptz DEFAULT now())`;
  await db`CREATE TABLE IF NOT EXISTS pageviews (day text, path text, views int DEFAULT 0, PRIMARY KEY (day, path))`;
  await db`DELETE FROM seen WHERE ts < now() - interval '7 days'`;
  const rows = await db`SELECT k FROM seen`;
  for (const r of rows) mem.seen.add(r.k);
  const kv = await db`SELECT k, v FROM kv`;
  for (const r of kv) mem.kv.set(r.k, r.v);
  const today = localDay();
  for (const k of [...mem.kv.keys()]) { // drop old daily counters and countdown markers
    const old = (k.startsWith("xcount:") && k !== `xcount:${today}`) || (k.startsWith("cd:") && Date.now() - Date.parse(k.slice(3)) > 2 * 86_400_000);
    if (old) { mem.kv.delete(k); await db`DELETE FROM kv WHERE k = ${k}`.catch(() => {}); }
  }
  log(`DB ready, ${mem.seen.size} seen keys`);
}
async function markSeen(keys: string[]) {
  for (const k of keys) mem.seen.add(k);
  if (db) for (const k of keys) await db`INSERT INTO seen (k) VALUES (${k}) ON CONFLICT DO NOTHING`.catch(() => {});
}
async function kvSet(k: string, v: string) {
  mem.kv.set(k, v);
  if (db) await db`INSERT INTO kv (k, v) VALUES (${k}, ${v}) ON CONFLICT (k) DO UPDATE SET v = ${v}`.catch(() => {});
}
function webCategory(t: string, kind: string) {
  if (kind === "earnings" || kind === "auction" || kind === "economic") return "markets";
  if (/fed\b|fomc|powell|central bank|rate (decision|cut|hike)|monetary|ecb|boj|boe/i.test(t)) return "fed";
  if (/oil|crude|gas\b|lng|opec|pipeline|refiner|energy|brent|wti/i.test(t)) return "energy";
  if (/bitcoin|ethereum|crypto|btc|eth\b|blockchain/i.test(t)) return "crypto";
  if (/war|military|missile|drone|strike|sanction|nato|troops|attack|ceasefire|iran|israel|russia|ukrain|china|taiwan|election|navy|houthi/i.test(t)) return "geopolitics";
  if (/stock|s&p|nasdaq|dow|yield|bond|treasur|equit|ipo|etf|shares|\$[A-Z]{1,5}\b/i.test(t)) return "markets";
  return "other";
}
async function saveNews(headline: string, content: string, kind: string, highAlert: boolean, source: string | null = null) {
  const day = localDay();
  mem.headlines.push({ day, title: headline });
  if (mem.headlines.length > 400) mem.headlines.shift();
  const ticker = headline.match(/\$([A-Z]{1,5})\b/)?.[1] || null;
  if (db) await db`INSERT INTO news (headline, content, category, ticker, high_alert, day, source, kind) VALUES (${headline}, ${content || null}, ${webCategory(headline, kind)}, ${ticker}, ${highAlert}, ${day}, ${source}, ${kind})`.catch((e) => log("db news", String(e)));
}
async function todaysHeadlines(): Promise<string[]> {
  const day = localDay();
  if (db) {
    const rows = await db`SELECT headline FROM news WHERE day = ${day} ORDER BY id`;
    return rows.map((r: any) => r.headline);
  }
  return mem.headlines.filter((h) => h.day === day).map((h) => h.title);
}

// ---------------------------------------------------------------- time helpers
function localParts(d = new Date()) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hour12: false })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return p as Record<string, string>;
}
const localDay = () => { const p = localParts(); return `${p.year}-${p.month}-${p.day}`; };
const localHM = () => { const p = localParts(); return `${p.hour === "24" ? "00" : p.hour}:${p.minute}`; };
const usDate = (d = new Date()) => d.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "long", day: "numeric", year: "numeric" });

// ---------------------------------------------------------------- RSS parsing
type Item = { guid: string; title: string; link: string; pubDate: number; content: string };

function decode(s: string) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&amp;/g, "&");
}
function htmlToText(s: string) {
  return decode(decode(s)).replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|li|div)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
function tag(block: string, name: string) {
  const m = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? m[1] : "";
}
export function parseFeed(xml: string): Item[] {
  const items: Item[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const b = m[1];
    const title = htmlToText(tag(b, "title")).replace(/^FinancialJuice:\s*/i, "").trim();
    const content = htmlToText(tag(b, "content:encoded") || tag(b, "description"));
    items.push({
      guid: decode(tag(b, "guid")).trim() || title,
      title,
      link: decode(tag(b, "link")).trim(),
      pubDate: Date.parse(decode(tag(b, "pubDate")).trim()) || Date.now(),
      content: content === title ? "" : content,
    });
  }
  return items;
}

// ---------------------------------------------------------------- filters & classification
const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// Always skipped (noise) — from the old skipKeywords list
const SKIP = [
  "Interest Rate Probabilities", "Correlation Matrix", "Implied Volatility", "Crib Sheet", "FX Option Expiries", "FX Options Expiries",
  "FX Options", "Fitch affirms", "Fitch confirms", "Fitch rates", "Fitch Assigns", "Moody's Ratings", "Morningstar DBRS", "DBRS Confirms",
  "DBRS Changes", "Morning Juice", "Week Ahead", "Secured overnight financing rate", "Effective Fed funds rate", "Baker Hughes",
  "FJElite", "MUFG:", "Credit Agricole", "Speaks -", "interview ends", "ends remarks", "CEO Speaks", "speaks at", "Huang Speaks",
  "Goldman Sachs speaking", "JPMorgan speaking", "Morgan Stanley speaking", "Bill Auction", "TIPS Auction", "Currency Strength Chart",
  "Utilization April", "Claimant", "Rightmove", "Halifax", "Nationwide",
  "at marginal rate", "overnight with it", "deposit facility usage", "marginal lending facility",
  // low-value routine items (Telegram readers asked for less noise)
  "Fed bids for", "Treasury WI", "WATCH LIVE", "Watch live", "Redbook", "ADP Wkly", "Fear & Greed", "Bid-to-Cover", "recruits",
  "to auction $", "bills on", "to offer NZ$", "Live stream", "LIVE:", "with it overnight", "press conference ends",
];
const MAG7 = /\$(AAPL|MSFT|NVDA|GOOGL?|AMZN|META|TSLA)\b|\b(Apple|Microsoft|Nvidia|Alphabet|Google|Amazon|Meta|Tesla)\b/i;
// Market-moving words: a speaker who has already been quoted several times still gets through with these
const MOVERS = /\b(hike|hikes|hiking|cut|cuts|cutting|recession|intervention|intervene|emergency|QE|tightening|easing|tariffs?|sanctions?|war|ceasefire|default|downgrade|upgrade)\b/i;
const FOREIGN_LEADER = /\b(Merz|Starmer|Macron|Meloni|S[aá]nchez|Carney|Albanese|Ishiba|Takaichi|Lee Jae[- ]myung|Luxon|Tusk|Orb[aá]n|Fico|Babi[sš]|Frederiksen|Kristersson|Schoof|De Wever|Costa|Mitsotakis|Montenegro|Reeves|Lombard)\b/i;
// a foreign leader on war, Russia/China/Iran, trade, the US, markets or a government crisis still always goes through
const LEADER_KEEP = /\b(Russia|Russian|Putin|Ukrain\w*|Zelensk\w*|war|attack|strike|drones?|missiles?|NATO|troops|military|defen[cs]e|nuclear|China|Chinese|Xi|Iran|Israel|Gaza|trade|tariffs?|United States|America|Trump|Washington|Fed|dollar|oil|gas|energy|bonds?|yields?|markets?|election|resign\w*|no[- ]confidence|collapse)\b/i;
const SPEAKER_CAP = Number(E.SPEAKER_CAP || 2); // quotes per speaker per hour before only market-moving lines pass
const SPEAKER_CAP_FOREIGN_CB = Number(E.SPEAKER_CAP_FOREIGN_CB || 1); // BoE/BoC/ECB/BoJ… officials matter less to US traders
const FOREIGN_CB = /^(BoE|BoC|ECB|BoJ|RBA|RBNZ|SNB|PBoC|Riksbank|Norges|Bank of (England|Canada|Japan))\b/i;
const FOREIGN_CB_ANY = /\b(BoE|BoC|ECB|BoJ|RBA|RBNZ|SNB|PBoC|Riksbank|Norges ?Bank|Bank of (England|Canada|Japan))\b/i;
const BROKER_CALL = /\b(expects?|we see|now sees?|forecasts?)\b/i;
const speakerLog = new Map<string, number[]>();
// "BoC's Gov. Macklem: ...", "BoE’s Greene: ...", "Putin: ..." -> macklem / greene / putin
export function speakerOf(title: string) {
  const m = title.match(/^([^:]{2,45}):\s/);
  if (!m || /\b(Actual|Forecast|Previous)\b/.test(title)) return null;
  const words = m[1].replace(/[’']s\b/g, "").split(/\s+/).filter((w) => /^[A-Za-z][A-Za-z.\-]*$/.test(w));
  return words.length ? words[words.length - 1].toLowerCase() : null;
}
// Extra noise filter on top of classify(): analyst price targets outside Mag 7, and long speech barrages from one speaker
export function noiseReason(title: string, highAlert: boolean, now = Date.now()): string | null {
  if (/target price|price target/i.test(title) && !MAG7.test(title)) return "price target";
  // daily futures settlements: keep only WTI crude and gold, drop gasoline/diesel/natgas/silver/copper… settles
  if (/\bsettle[sd]?\b/i.test(title) && /futures/i.test(title) && !/\b(WTI|Crude|Gold)\b/i.test(title)) return "minor settlement";
  // bank/broker calls on a FOREIGN central bank ("BMO expects Bank of Canada to hike", "Nomura: We see the BOC to hike") — Fed calls stay
  if (!highAlert && BROKER_CALL.test(title) && FOREIGN_CB_ANY.test(title) && !FOREIGN_CB.test(title) && !/\b(Fed|FOMC|Powell)\b/.test(title)) return "foreign CB broker call";
  if (!highAlert) {
    // Peru ministry growth/deficit forecasts (4× in one night) — no impact on US markets
    if (/\bPeru(vian)?\b|\bPeru[’']s\b/i.test(title) && /\b(growth|deficit|GDP|forecast|outlook|projection)\b/i.test(title)) return "minor EM forecast";
    // China coke / coking coal futures moves (4× in one night)
    if (/\bcok(e|ing coal)\b/i.test(title) && /\b(Chin|Dalian)/i.test(title) && /\b(contract|futures)\b/i.test(title)) return "China coke futures";
    // Chinese space-program updates
    if (/\b(Shenzhou|Tiangong)\b/i.test(title)) return "space mission";
    // astronaut missions / "space ties" diplomacy (Xi–Pakistan joint mission, 4× in one morning); SpaceX etc. not matched
    if (/\bastronauts?\b/i.test(title) || /\bspace (ties|partnerships?|cooperation)\b/i.test(title)) return "space mission";
    // daily LME warehouse stock reports (copper/nickel/zinc/aluminium inventory, 4+ lines at once); LME price moves, halts, suspensions still pass
    if (/\bLME\b/i.test(title) && /\b(stocks?|inventor(y|ies)|warehouses?|on[- ]warrant|cancel+ed warrants?)\b/i.test(title) && !/\b(suspend\w*|halt\w*|record|prices?|surge\w*|plunge\w*|squeeze)\b/i.test(title)) return "LME stocks";
    // UK regulator Ofcom consultations ("Ofcom Seeks Views on Faster Takedowns…") — fines/probes of big tech still pass
    if (/\bOfcom\b/i.test(title) && /\b(seeks? views|consult\w*|call for evidence)\b/i.test(title) && !MAG7.test(title) && !/\b(fines?d?|probe|investigat\w*|Musk|TikTok)\b/i.test(title)) return "UK regulator consultation";
    // QatarEnergy MoUs / partnership talks (2×) — production cuts, LNG force majeure or outages still pass
    if (/\bQatar ?Energy\b/i.test(title) && /\b(MoUs?|memorandum|partners?|partnership|explore|joint projects?|ties)\b/i.test(title)) return "energy MoU";
    // "WH Sr. Adviser Hassett's interview on Fox Business ends." — end of a TV interview says nothing; Fed/Powell lines stay
    if (/\binterview\b/i.test(title) && /\b(ends|ended|concludes|concluded|is over|wraps up)\b/i.test(title) && !/\b(Fed|FOMC|Powell)\b/i.test(title)) return "interview ends";
    // Fitch notes on foreign issuers (bank notes, regional outlooks); US/Treasury ratings and down/upgrades stay
    if (/\bFitch\b/i.test(title) && !/\b(U\.?S\.?|United States|America|Treasury)\b/i.test(title) && !/\b(downgrad|upgrad|default|cuts?\b|negative|watch)/i.test(title)) return "foreign rating note";
  }
  // foreign heads of government talking domestic politics (Merz on the German budget: 4+ lines in a morning).
  // Their titles often have no "Name:" prefix ("GERMAN CHANCELLOR MERZ SAYS …"), so speakerOf() misses them.
  const leader = !highAlert && title.match(FOREIGN_LEADER)?.[1]?.toLowerCase().replace(/\s+/g, " ");
  if (leader && !LEADER_KEEP.test(title) && !/\b(U\.S\.?|US|USA)\b/.test(title) && !MOVERS.test(title)) {
    if (/\bbudgets?\b/i.test(title)) return "foreign budget talk";
    const lt = (speakerLog.get("leader:" + leader) || []).filter((t) => now - t < 60 * 60_000);
    if (lt.length >= SPEAKER_CAP) { speakerLog.set("leader:" + leader, lt); return "speaker cap (" + leader + ")"; }
    lt.push(now); speakerLog.set("leader:" + leader, lt);
  }
  const sp = speakerOf(title);
  // Mag 7 headlines are never capped ("Amazon: …" product news was cut by the speaker cap)
  // lines about the Fed (Hassett: "We expect Warsh, and the Fed will be data-driven") are never capped either
  if (!sp || highAlert || MAG7.test(title) || /\b(Fed|FOMC|Powell|Warsh)\b/.test(title) || ALWAYS_ALLOW.some((k) => title.toLowerCase().includes(k))) return null;
  const times = (speakerLog.get(sp) || []).filter((t) => now - t < 60 * 60_000);
  const cap = FOREIGN_CB.test(title) ? SPEAKER_CAP_FOREIGN_CB : SPEAKER_CAP;
  if (times.length >= cap && !MOVERS.test(title)) { speakerLog.set(sp, times); return "speaker cap (" + sp + ")"; }
  times.push(now); speakerLog.set(sp, times);
  return null;
}
// Non-US economic data is skipped, but geopolitics about these countries (e.g. China/Taiwan) still goes through
const NON_US = [
  "German", "Germany", "French", "France", "Italian", "Spanish", "Spain", "Eurozone", "Euro Zone", "ECB", "BoC", "Bank of Canada",
  "Swiss", "Switzerland", "Swedish", "Norway", "Norwegian", "Danish", "Denmark", "Australian", "Australia", "RBA", "New Zealand",
  "RBNZ", "Japanese", "Japan", "BoJ", "Chinese", "China", "PBoC", "Korean", "BoK", "Indian", "RBI", "Brazilian", "Turkish", "TCMB",
  "Canadian", "British", "UK ", "BoE", "Dutch", "Netherlands", "Belgian", "Belgium", "Austrian", "Austria", "Portuguese", "Portugal",
  "Finnish", "Finland", "Greek", "Greece", "Czech", "Hungary", "Polish", "Poland", "Romanian", "Romania", "Mexican",
];
const ALWAYS_ALLOW = ["rate decision", "rate hike", "rate cut", "emergency rate", "federal reserve", "fomc", "powell", "rate unchanged", "cuts rates", "raises rates", "holds rates"];
// strong = clearly a data release; weak words (orders, budget, output…) also appear in geopolitics, so they need a number next to them
const DATA_STRONG = /\b(Actual|Forecast|Previous|PMI|CPI|PPI|HICP|GDP|Retail Sales|Unemployment Rate|Jobless|Payrolls|Trade Balance|Industrial Production|House Prices?|Current Account|Money Supply)\b/i;
const DATA_WEAK = /\b(Unemployment|Housing|Sentiment|Confidence|Inflation|Employment|Wages|Earnings|Orders|Output|Lending|Budget|Auction)\b/i;
const DATA_NUM = /\d/, DATA_UNIT = /%|\b(YoY|MoM|QoQ|Y\/Y|M\/M|Q\/Q)\b/i;

const HIGH_ALERT_RE = new RegExp(
  [
    "earthquake", "tsunami", "terror", "nuclear (?:test|strike|attack|weapon|threat)", "declares? war", "war (?:has )?(?:started|begins)",
    "invad", "invasion", "missile (?:strike|attack)", "air ?strikes?", "explosion", "assassinat", "shot (?:dead|at)", "shooting", "shots fired",
    "\\bcoup\\b", "martial law", "state of emergency", "circuit breaker", "trading halt", "halts trading", "\\bdefaults?\\b", "bank (?:failure|collapse)",
    "emergency (?:rate|meeting)", "rate decision", "cuts rates", "raises rates", "rate hike", "rate cut", "sanctions? (?:on|against|imposed)",
    "imposes sanctions", "naval blockade", "currency crisis", "flash crash", "market crash", "plane crash", "breaking",
  ].join("|"), "i");

type Kind = "imbalance" | "cftc" | "earnings" | "economic" | "auction" | "news";
type Classified = { skip: boolean; kind: Kind; highAlert: boolean; reason?: string };

export function classify(it: Item): Classified {
  const t = it.title, full = `${t}\n${it.content}`, tl = t.toLowerCase();
  if (/FJElite/i.test(t)) return { skip: true, kind: "news", highAlert: false, reason: "FJElite" };
  if (/^(MOO|MOC) Imbalance/i.test(t)) return { skip: false, kind: "imbalance", highAlert: false };
  if (/^CFTC Positions/i.test(t)) return { skip: false, kind: "cftc", highAlert: false };
  const allow = ALWAYS_ALLOW.some((k) => tl.includes(k));
  if (!allow && SKIP.some((k) => t.includes(k))) return { skip: true, kind: "news", highAlert: false, reason: "skip-list" };
  const dataLike = DATA_STRONG.test(t) || /\bActual\b/i.test(it.content) || (DATA_WEAK.test(t) && DATA_NUM.test(t) && DATA_UNIT.test(t));
  if (!allow && dataLike && NON_US.some((k) => t.includes(k))) return { skip: true, kind: "news", highAlert: false, reason: "non-US data" };
  if (!t || t.length < 8) return { skip: true, kind: "news", highAlert: false, reason: "empty" };

  let kind: Kind = "news";
  if (/\bEPS\b|\bRevenue\b|\bearnings\b|\bguidance\b|Q[1-4] (?:results|earnings|sales)/i.test(full) && /\$[A-Z]{1,5}\b|\bEPS\b/.test(full)) kind = "earnings";
  else if (/\bauction\b|bid[- ]to[- ]cover/i.test(full)) kind = "auction";
  else if (/\bActual\b/i.test(full) || (/\bForecast\b/i.test(full) && /\bPrevious\b/i.test(full))) kind = "economic";
  return { skip: false, kind, highAlert: HIGH_ALERT_RE.test(t) };
}

// ---------------------------------------------------------------- Claude
const deadModels = new Set<string>();
async function claude(prompt: string, maxTokens = 500, timeoutMs = 8000, smart = false): Promise<string | null> {
  if (!ANTHROPIC_KEY) return null;
  for (const model of (smart ? MODELS_SMART : MODELS_FAST).filter((m) => !deadModels.has(m))) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        signal: ac.signal,
        headers: { "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
      });
      const j: any = await r.json().catch(() => ({}));
      if (r.status === 404 || j?.error?.type === "not_found_error") { deadModels.add(model); log("model not available, trying next:", model); continue; }
      if (!r.ok) { health.claudeFails++; health.claudeLastError = `${r.status} ${j?.error?.message || ""}`.slice(0, 200); log("Claude error", r.status, JSON.stringify(j).slice(0, 300)); return null; }
      health.claudeFails = 0;
      return (j.content?.map((c: any) => c.text || "").join("") || "").trim() || null;
    } catch (e) { health.claudeFails++; health.claudeLastError = String(e).slice(0, 200); log("Claude failed", String(e)); return null; } finally { clearTimeout(timer); }
  }
  health.claudeFails++; health.claudeLastError = "no model available";
  return null;
}

// ---------------------------------------------------------------- Telegram
const tgApi = (m: string) => `https://api.telegram.org/bot${TG_TOKEN}/${m}`;
async function tgCall(method: string, body: Record<string, any> | FormData, tries = 3): Promise<any> {
  if (DRY_RUN || !TG_TOKEN) { log(`[TG ${method}]`, body instanceof FormData ? body.get("caption") : body.text); return { ok: true, result: { message_id: 0 } }; }
  const isForm = body instanceof FormData;
  const toChannel = isForm ? body.get("chat_id") === TG_CHAT : body.chat_id === TG_CHAT;
  const fail = (why: string) => { if (toChannel) { health.tgFails++; health.tgLastError = why.slice(0, 200); } };
  let j: any = { ok: false };
  for (let i = 0; i < tries; i++) {
    let r: Response;
    try {
      r = await fetch(tgApi(method), { method: "POST", signal: tmo(isForm ? 90_000 : 15_000), ...(isForm ? { body } : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    } catch (e: any) {
      log("TG network error", method, String(e));
      j = { ok: false, description: String(e) };
      if (e?.name === "TimeoutError") break; // may already be delivered — retrying could post it twice
      await Bun.sleep(400 * (i + 1)); continue; // connection problem: nothing was sent, safe to retry
    }
    j = await r.json().catch(() => ({}));
    if (j.ok) { health.tgFails = 0; return j; }
    if (r.status === 429 && j.parameters?.retry_after) { await Bun.sleep(j.parameters.retry_after * 1000); continue; }
    if (r.status >= 500) { await Bun.sleep(400 * (i + 1)); continue; }
    log("TG error", method, r.status, JSON.stringify(j).slice(0, 300));
    fail(`${r.status} ${j.description || ""}`);
    return j;
  }
  fail(String(j.description || "no response"));
  return j;
}
type Media = { bytes: Uint8Array; kind: "photo" | "video"; mime: string };
const pngMedia = (b: Uint8Array | null): Media | null => (b ? { bytes: b, kind: "photo", mime: "image/png" } : null);

const tgText = (text: string) => tgCall("sendMessage", { chat_id: TG_CHAT, text: text.slice(0, 4096), disable_web_page_preview: true });
async function tgMedia(m: Media | null, caption: string) {
  if (!m) return tgText(caption);
  const fd = new FormData();
  fd.append("chat_id", TG_CHAT);
  const field = m.kind === "video" ? "video" : "photo";
  fd.append(field, new Blob([m.bytes], { type: m.mime }), m.kind === "video" ? "video.mp4" : "image." + (m.mime.split("/")[1] || "jpg"));
  if (m.kind === "video") fd.append("supports_streaming", "true");
  if (caption.length <= 1024) { fd.append("caption", caption); return tgCall(m.kind === "video" ? "sendVideo" : "sendPhoto", fd); }
  const r = await tgCall(m.kind === "video" ? "sendVideo" : "sendPhoto", fd); // caption too long: media first, full text right after
  await tgText(caption);
  return r;
}
const tgPin = (message_id: number) => message_id && tgCall("pinChatMessage", { chat_id: TG_CHAT, message_id, disable_notification: true });

// ---------------------------------------------------------------- X (OAuth 1.0a)
const pct = (s: string) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
function oauthHeader(method: string, url: string) {
  const o: Record<string, string> = {
    oauth_consumer_key: X_KEY, oauth_nonce: randomBytes(16).toString("hex"), oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(), oauth_token: X_TOKEN, oauth_version: "1.0",
  };
  const u = new URL(url);
  const params = [...Object.entries(o), ...u.searchParams.entries()].map(([k, v]) => [pct(k), pct(v)]).sort((a, b) => (a[0] + a[1] < b[0] + b[1] ? -1 : 1));
  const base = [method.toUpperCase(), pct(u.origin + u.pathname), pct(params.map(([k, v]) => `${k}=${v}`).join("&"))].join("&");
  o.oauth_signature = createHmac("sha1", `${pct(X_SECRET)}&${pct(X_TOKEN_SECRET)}`).update(base).digest("base64");
  return "OAuth " + Object.entries(o).map(([k, v]) => `${pct(k)}="${pct(v)}"`).join(", ");
}
async function xRequest(url: string, body?: any, method = "POST") {
  const init: RequestInit = { method, headers: { Authorization: oauthHeader(method, url) }, signal: tmo(body instanceof FormData ? 120_000 : 30_000) };
  if (body instanceof FormData) init.body = body; // multipart body is not part of the OAuth signature
  else if (body !== undefined) { (init.headers as any)["content-type"] = "application/json"; init.body = JSON.stringify(body); }
  let r: Response;
  try { r = await fetch(url, init); }
  catch (e) { log("X network error", url, String(e)); health.xLastError = String(e).slice(0, 200); health.xLastErrorAt = Date.now(); return { ok: false, status: 0, j: {} as any }; }
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) { log("X error", url, r.status, JSON.stringify(j).slice(0, 400)); health.xLastError = `${r.status} ${j?.detail || j?.title || ""}`.slice(0, 200); health.xLastErrorAt = Date.now(); }
  else if (url.endsWith("/2/tweets")) health.xLastOkAt = Date.now();
  return { ok: r.ok, status: r.status, j };
}
async function xUpload(m: Media): Promise<string | null> {
  if (m.kind === "photo") {
    const up = await xRequest("https://api.x.com/2/media/upload", { media: Buffer.from(m.bytes).toString("base64"), media_category: "tweet_image" });
    return up.j?.data?.id ? String(up.j.data.id) : null;
  }
  const init = await xRequest("https://api.x.com/2/media/upload/initialize", { media_type: m.mime || "video/mp4", total_bytes: m.bytes.length, media_category: "tweet_video" });
  const id = init.j?.data?.id;
  if (!id) return null;
  const CH = 4 * 1024 * 1024;
  for (let i = 0, seg = 0; i < m.bytes.length; i += CH, seg++) {
    const fd = new FormData();
    fd.append("segment_index", String(seg));
    fd.append("media", new Blob([m.bytes.subarray(i, i + CH)]), "chunk");
    const a = await xRequest(`https://api.x.com/2/media/upload/${id}/append`, fd);
    if (!a.ok) return null;
  }
  let fin = await xRequest(`https://api.x.com/2/media/upload/${id}/finalize`);
  let info = fin.j?.data?.processing_info;
  for (let n = 0; info && info.state !== "succeeded" && n < 30; n++) {
    if (info.state === "failed") return null;
    await Bun.sleep((info.check_after_secs || 2) * 1000);
    info = (await xRequest(`https://api.x.com/2/media/upload?command=STATUS&media_id=${id}`, undefined, "GET")).j?.data?.processing_info;
  }
  return String(id);
}
function xBudgetLeft() {
  const k = `xcount:${localDay()}`;
  return X_DAILY_CAP - Number(mem.kv.get(k) || 0);
}
let xShortUntil = 0; // set when X refuses long posts (no Premium): skip the long attempt for a few hours
async function xPost(text: string, m?: Media | null, force = false) {
  if (!xEnabled) return;
  if (!force && xBudgetLeft() <= 0) return log("X daily cap reached, skipping");
  const clean = text.replace(/https?:\/\/\S+/g, "").replace(/[ \t]+\n/g, "\n").trim(); // links cost 13x more on X — never post them
  if (DRY_RUN) return log("[X]", clean.slice(0, 200), m ? `(+${m.kind})` : "");
  const k = `xcount:${localDay()}`;
  const bump = (d: number) => mem.kv.set(k, String(Math.max(0, Number(mem.kv.get(k) || 0) + d)));
  bump(1); // reserve the slot before the request, so posts sent at the same moment cannot overshoot the daily cap
  let res: Awaited<ReturnType<typeof xRequest>> = { ok: false, status: 0, j: {} };
  try {
    const mediaId = m ? await xUpload(m).catch((e) => { log("X upload failed", String(e)); return null; }) : null;
    const body = (t: string) => (mediaId ? { text: t, media: { media_ids: [mediaId] } } : { text: t });
    const short = clean.length > 280 ? clean.slice(0, 276).replace(/\s+\S*$/, "") + " …" : clean;
    const shortOnly = Date.now() < xShortUntil;
    res = await xRequest("https://api.x.com/2/tweets", body(shortOnly ? short : clean));
    if (!res.ok && !shortOnly && clean.length > 280 && (res.status === 400 || res.status === 403)) { // account without X Premium: fall back to a short version
      res = await xRequest("https://api.x.com/2/tweets", body(short));
      if (res.ok) { xShortUntil = Date.now() + 6 * 3600_000; log("X accepts only short posts (no Premium?) — using short version for the next 6 h"); }
    }
  } finally {
    if (!res.ok) bump(-1);
    await kvSet(k, mem.kv.get(k) || "0");
  }
  return res;
}

// ---------------------------------------------------------------- images (cached in memory)
const imgCache: Record<string, Uint8Array | null> = {};
async function image(name: keyof typeof IMG) {
  if (imgCache[name]) return imgCache[name];
  try {
    const r = await fetch(IMG[name], { signal: tmo(15_000), headers: { "User-Agent": "Mozilla/5.0", Referer: "https://postimg.cc/" } });
    const ct = r.headers.get("content-type") || "";
    if (r.ok && ct.startsWith("image/")) return (imgCache[name] = new Uint8Array(await r.arrayBuffer()));
    log("image fetch failed", name, r.status, ct);
  } catch (e) { log("image fetch error", name, String(e)); }
  return null;
}

// ---------------------------------------------------------------- formatters
function regularText(it: Item, c: Classified) {
  const prefix = c.highAlert ? "🚨 HIGH ALERT: " : "⚡ ";
  let s = prefix + it.title;
  if (it.content) s += "\n" + it.content;
  if (/WATCH LIVE|LIVE:/i.test(it.title) && it.link) s += "\n🔗 " + it.link;
  return s;
}

async function formatData(it: Item, c: Classified): Promise<string> {
  const out = await claude(
    `You are a financial news formatter for Twitter/X. Format this news into an engaging structured post.

Title: ${it.title}
Content: ${it.content}
Category: ${c.kind}
High Alert: ${c.highAlert}

Rules:
- Start with relevant emoji + $TICKER if available
- Add 🚨 at start if this is high-impact (high alert, or a big surprise vs forecast in CPI, PPI, NFP, GDP, retail sales, rate decisions)
- For earnings: show EPS, Revenue, Guidance with estimates
- For auction: show Yield, Bid-to-Cover, Size, Allocation with →
- For economic: show Actual, Forecast, Previous and surprise direction (e.g. "Direction: ↓ MISS (missed by -2.3 points)")
- Structure as clean lines with labels
- You may add one short line of context (max 120 chars) after the numbers
- End with 2 relevant hashtags
- Be concise and professional
- No quotation marks, no markdown, never invent numbers that are not in the data`,
    400, 6000,
  );
  return out || regularText(it, c);
}

export function parseImbalance(text: string) {
  const src = text.replace(/[−–—]/g, "-"); // typographic minus signs must not lose the sign
  const NUM = String.raw`:\s*([+-]?\s?\$?\s?\d[\d,]*(?:\.\d+)?)\s*(bln|billion|bn|b\b|mln|million|m\b)?`;
  const grab = (name: string) => {
    const m = src.match(new RegExp(name + "[^:\\n]*" + NUM, "i"));
    if (!m) return null;
    let v = parseFloat(m[1].replace(/[,\s$]/g, ""));
    if (isNaN(v)) return null;
    if (/^b/i.test(m[2] || "")) v *= 1000; // billions -> millions
    return Math.round(v);
  };
  return { "S&P 500": grab("S&P"), "Nasdaq 100": grab("Nasdaq"), "Dow 30": grab("Dow"), "Mag 7": grab(String.raw`Mag\s?7`) } as Record<string, number | null>;
}
const fmtM = (v: number) => (v < 0 ? "-" : "+") + "$" + (Math.abs(v) >= 1000 ? (Math.abs(v) / 1000).toFixed(2) + "b" : Math.abs(v) + "m");
const dot = (v: number) => (Math.abs(v) < 50 ? "🟡" : v > 0 ? "🟢" : "🔴");

async function formatImbalance(it: Item) {
  const type = /MOO/i.test(it.title) ? "MOO" : "MOC";
  const vals = parseImbalance(it.content || it.title);
  const known = Object.entries(vals).filter(([, v]) => v !== null) as [string, number][];
  const dataLine = known.map(([k, v]) => `${k}: ${fmtM(v)}`).join(", ");
  const raw = await claude(
    `You are a financial analyst writing for institutional traders. ${type} (Market ${type === "MOO" ? "on Open" : "on Close"}) imbalance figures (positive = buy imbalance, negative = sell imbalance):
${dataLine}

Return ONLY valid JSON, no markdown:
{"S&P 500":"...","Nasdaq 100":"...","Dow 30":"...","Mag 7":"...","bottom":"..."}
Each index value: 1 direct sentence, max 80 characters, about what this imbalance means for traders at the ${type === "MOO" ? "open" : "close"}. Respect the sign: negative = selling pressure.
"bottom": 2 sentences max, under 180 characters total, the trading takeaway${type === "MOC" ? " including what it may mean for tomorrow's open" : ""}.`,
    600, 9000,
  );
  let a: Record<string, string> = {};
  try { a = JSON.parse((raw || "").replace(/```json|```/g, "").match(/\{[\s\S]*\}/)?.[0] || "{}"); } catch {}
  const lines = known.map(([k, v]) => `${dot(v)} ${k} at ${fmtM(v)}${a[k] ? " — " + a[k] : ""}`);
  let text = `🇺🇸 ${type} Imbalance — ${usDate()}\n\n${lines.join("\n\n")}`;
  if (a.bottom) text += `\n\nBottom line: ${a.bottom}`;
  if (!known.length) text += `\n\n${it.content}`;
  if (db) {
    const analysis = lines.join("\n\n") + (a.bottom ? `\n\nBottom line: ${a.bottom}` : "");
    await db`INSERT INTO imbalances (type, sp500, nasdaq, dow30, mag7, claude_analysis) VALUES (${type}, ${vals["S&P 500"] ?? 0}, ${vals["Nasdaq 100"] ?? 0}, ${vals["Dow 30"] ?? 0}, ${vals["Mag 7"] ?? 0}, ${analysis})`.catch((e) => log("db imb", String(e)));
  }
  return { type, text };
}

async function formatCFTC(it: Item) {
  const out = await claude(
    `Analyze these CFTC positioning data and create a detailed market analysis post.

Format EXACTLY like this:
📊 CFTC Week [date from data]

🔴 [Bearish signal title]
[One sentence explanation with specific numbers]

🟢 [Bullish signal title]
[One sentence explanation with specific numbers]

🟢 [Another bullish/bearish signal]
[One sentence explanation with specific numbers]

Bottom line: [One sentence summary with market outlook] 📈 or 📉

Rules:
- Use specific contract numbers from the data
- Max 3-4 signals, pick the most important ones
- Keep each explanation under 2 sentences
- End with clear bottom line for traders
- No hashtags, no markdown

Data: ${it.title}
${it.content}`,
    800, 15000,
  );
  if (db && out) {
    const dm = it.title.match(/(?:Week (?:Ended|of)\s+)([A-Za-z]+ \d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})/i);
    const week = dm ? new Date(`${dm[1]} ${dm[2]}`) : null;
    await db`INSERT INTO cftc (week_ending, data, claude_analysis) VALUES (${week && !isNaN(+week) ? week.toISOString().slice(0, 10) : null}, ${JSON.stringify({ title: it.title, content: it.content })}::jsonb, ${out})`.catch((e) => log("db cftc", String(e)));
  }
  return out || `📊 ${it.title}\n\n${it.content}`;
}

// ---------------------------------------------------------------- pipeline
const stats = { started: new Date().toISOString(), polls: 0, http429: 0, lastPoll: "", interval: POLL_MS, posted: 0, skipped: 0, lastLatencies: [] as number[], errors: 0 };

// fuzzy duplicate check across all sources (FJ RSS + Telegram channels): same story, different wording
const STOP = new Set("the a an and or of to in on for at by with from as is are was were be been it its this that says said say will would after over amid into than per via has have had not no new just breaking report reports reported according source sources".split(" "));
const recent: { tokens: Set<string>; ts: number; src: string; data?: boolean }[] = [];
const toks = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length > 2 && !STOP.has(w)));
// Only compares across DIFFERENT sources: items from one source are already de-duplicated by id, and similar-looking
// lines from the same source are usually separate facts (CPI MoM vs CPI YoY, initial vs continuing claims, two Fed speakers).
export function isDuplicateStory(text: string, src = "feed", now = Date.now()) {
  const t = toks(text);
  const isData = /\bActual\b/.test(text);
  while (recent.length && now - recent[0].ts > 90 * 60_000) recent.shift();
  if (t.size < 3) return false;
  for (const r of recent) {
    let inter = 0;
    for (const w of t) if (r.tokens.has(w)) inter++;
    const overlap = inter / Math.min(t.size, r.tokens.size);
    if (r.src !== src && overlap >= 0.7 && inter >= 4) return true;
    // same source repeating itself (e.g. 6 WSJ tariff lines in 3 minutes) — never for data lines like CPI MoM/YoY
    if (r.src === src && !isData && !r.data && overlap >= 0.8 && inter >= 4 && now - r.ts < 15 * 60_000) return true;
  }
  recent.push({ tokens: t, ts: now, src, data: isData });
  return false;
}

type ItemOpts = { via?: string; sourceName?: string; media?: Media | null; alert?: boolean };

// Posts from other Telegram channels are reworded (same facts, our own wording), so they go out without a "Source:" line.
// CHANNEL_REWRITE=off turns rewording off; CHANNEL_CREDIT=on adds the source line back.
const CHANNEL_REWRITE = (E.CHANNEL_REWRITE || "on").toLowerCase() !== "off";
const CHANNEL_CREDIT = (E.CHANNEL_CREDIT || "off").toLowerCase() === "on";
const nums = (s: string) => (s.match(/\d+(?:[.,]\d+)*/g) || []).map((n) => n.replace(/,/g, ""));
export async function rewriteChannelPost(title: string, content: string): Promise<{ title: string; content: string } | null> {
  const original = content ? `${title}\n${content}` : title;
  const out = await claude(
    `Rewrite this breaking financial news item in your own words for a fast news feed.
Rules: keep every fact, number, percentage, price, name and $TICKER exactly; remove any source or outlet attribution (e.g. "- Reuters", "per WSJ", "according to Bloomberg", "citing sources", "reports say") and any channel name; do not add facts, opinions, emoji, hashtags or links; do not mention Telegram or who posted it; keep it about as short as the original; first line is the headline, any extra detail on the next lines; English only. Output only the rewritten text.

${original}`, 300, 3500);
  if (!out) return null;
  const clean = out.replace(/^["“]|["”]$/g, "").trim();
  // safety: every number of the original must still be there, otherwise keep the original wording
  const have = new Set(nums(clean));
  if (nums(original).some((n) => !have.has(n))) { log("rewrite changed numbers, keeping original:", title.slice(0, 80)); return null; }
  const [t, ...rest] = clean.split("\n");
  return { title: stripAttribution(t), content: rest.map(stripAttribution).join("\n").trim() };
}
// safety net if the model leaves a trailing source: "… - Reuters", "… (Bloomberg)", "…, per WSJ", "…, citing sources"
const OUTLETS = "Reuters|RTRS|Bloomberg|BBG|WSJ|Wall Street Journal|FT|Financial Times|CNBC|AP|AFP|Axios|NYT|New York Times|Politico|Semafor|Tass|TASS|RIA|IRIB|Fars|Tasnim|Xinhua|Nikkei|Kyodo|Yonhap|Al Arabiya|Al Jazeera|NBC|CBS|ABC|CNN|Fox|BBC|Sky|Dow Jones|MNI|Barron's|The Information|Chosun|JoongAng|Handelsblatt|Interfax|Caixin|SCMP|Jiji|NHK|Asahi|Yomiuri|ANSA|Mehr|IRNA|ISNA|sources?|officials";
// "… - Reuters", "… | Chosun", "…, per WSJ", "(according to Bloomberg News)", "…, says Reuters". A bare "says"/"reports" (no comma)
// is a normal sentence ("Powell says officials are united"), and "self-appointed" is not "- AP", so those stay.
const ATTRIB_RE = new RegExp(String.raw`(?:\s+[-–—]\s*|\s*\|\s*|,?\s*\(?\s*(?:per|via|citing|according to|reported by)\s+|,\s*(?:reports?|says)\s+)(?:${OUTLETS})\b(?:[^.\n]{0,40})?\)?\.?\s*$`, "i");
export function stripAttribution(line: string) {
  let out = stripHandles(line.trim());
  // "… - WSJ. $NVDA": a trailing cashtag hid the outlet from the end-anchored regexes; strip it, then put the tickers back
  const tags = out.match(/(?:\s+\$[A-Z]{1,6})+\s*$/)?.[0] || "";
  if (tags && out.length > tags.length) {
    const head = stripAttribution(out.slice(0, out.length - tags.length));
    if (head !== out.slice(0, out.length - tags.length).trim()) return head + " " + tags.trim().replace(/\s+/g, " ");
  }
  const reportsRe = new RegExp(String.raw`(?:,|\s[-–—])\s*(?:${OUTLETS})\s+(?:reports?|reported|says|said)\.?\s*$`, "i");
  for (let i = 0; i < 2; i++) out = out.replace(ATTRIB_RE, "").replace(reportsRe, "").replace(/\s*\((?:Reuters|Bloomberg|AP|AFP|WSJ|CNBC)\)\s*$/i, "").trim();
  return out || line.trim();
}
async function handleItem(it: Item, opts: ItemOpts = {}) {
  const via = opts.via || "feed";
  const c = classify(it);
  if (opts.alert) c.highAlert = true;
  if (mem.kv.get("paused") === "1" && via !== "test") return log("paused, not posting:", it.title.slice(0, 80));
  if (c.skip) { stats.skipped++; return log("skip", c.reason, "|", it.title.slice(0, 90)); }
  if (c.kind !== "imbalance" && c.kind !== "cftc" && via !== "test" && isDuplicateStory(it.title, via)) { stats.skipped++; return log("duplicate story", `(${via})`, it.title.slice(0, 90)); }
  const noise = c.kind === "news" && via !== "test" ? noiseReason(it.title, c.highAlert || !!opts.alert) : null;
  if (noise) { stats.skipped++; return log("skip", noise, "|", it.title.slice(0, 90)); }
  // feed headlines end with their outlet too ("… - Chosun", "… - Source"): drop it, Marian wants no sources in posts
  if (!via.startsWith("tg:") && c.kind === "news") it = { ...it, title: stripAttribution(it.title) };
  if (via.startsWith("tg:") && CHANNEL_REWRITE && c.kind === "news") {
    const rw = await rewriteChannelPost(it.title, it.content);
    if (rw?.title) it = { ...it, title: rw.title, content: rw.content };
    // rewrite failed or was rejected (numbers changed): still drop "- Reuters", "per WSJ"… from the original wording
    else it = { ...it, title: stripAttribution(it.title), content: it.content.split("\n").map(stripAttribution).join("\n").trim() };
  }
  const credit = opts.sourceName && CHANNEL_CREDIT ? `\n\nSource: ${opts.sourceName}` : ""; // optional source line at the very bottom
  const latency = Math.round((Date.now() - it.pubDate) / 1000);
  const toX = X_MODE === "all" || c.highAlert || c.kind !== "news";

  if (c.kind === "imbalance") {
    const { type, text } = await formatImbalance(it);
    const img = pngMedia(await image(type as "MOO" | "MOC"));
    await Promise.all([tgMedia(img, text), toX && xPost(text, img, true)]);
  } else if (c.kind === "cftc") {
    const text = await formatCFTC(it);
    await Promise.all([tgText(text), xPost(text, null, true)]);
  } else if (c.kind === "earnings" || c.kind === "economic" || c.kind === "auction") {
    const text = (await formatData(it, c)) + credit; // option B: wait ~1-2 s for Claude, then post the formatted version
    await Promise.all([tgMedia(opts.media || null, text), toX && xPost(text, opts.media)]);
  } else {
    const text = regularText(it, c) + credit; // instant: no AI in the path
    await Promise.all([tgMedia(opts.media || null, text), toX && xPost(text, opts.media)]);
  }
  stats.posted++;
  health.lastPostAt = Date.now();
  stats.lastLatencies = [latency, ...stats.lastLatencies].slice(0, 20);
  if (c.kind !== "imbalance" && c.kind !== "cftc") await saveNews(it.title, it.content, c.kind, c.highAlert, CHANNEL_CREDIT ? opts.sourceName || (via === "feed" ? "FinancialJuice" : null) : null);
  log(`posted [${c.kind}${c.highAlert ? ",ALERT" : ""}${toX ? ",X" : ""}${opts.media ? "," + opts.media.kind : ""}] +${latency}s (${via}) | ${it.title.slice(0, 90)}`);
}

async function handleFeed(xml: string, seedOnly = false) {
  const items = parseFeed(xml).sort((a, b) => a.pubDate - b.pubDate);
  const fresh: Item[] = [];
  for (const it of items) {
    // title key includes the text and the day: "MOC Imbalance" has the same title every day and must not be blocked tomorrow
    const keys = [`g:${it.guid}`, `t:${localDay()}:${norm(it.title)}|${norm(it.content).slice(0, 120)}`];
    if (keys.some((k) => mem.seen.has(k))) continue;
    if (seedOnly) { await markSeen(keys); continue; }
    markSeen(keys); // memory is updated at once; the database write must not delay the post
    if (Date.now() - it.pubDate > MAX_AGE_MIN * 60_000) { log("old item ignored", it.title.slice(0, 80)); continue; }
    fresh.push(it);
  }
  for (const it of fresh) handleItem(it).catch((e) => { stats.errors++; log("item error", String(e)); });
}

// FinancialJuice limits how often one IP may ask. The loop learns the fastest safe interval by itself:
// a 429 doubles the wait (or honours Retry-After) and raises the "floor"; after a calm stretch it probes slightly faster again.
const feedStat = { ok: 0, r429: 0, notModified: 0, floor: POLL_MS, last429: "", headers429: "" };
async function pollLoop() {
  feedStat.floor = Math.max(POLL_MS, Number(mem.kv.get("feed_floor") || 0)); // remembered across restarts
  let interval = feedStat.floor, okStreak = 0, etag = "", lastMod = "", savedFloor = feedStat.floor;
  const firstRun = mem.seen.size === 0; // empty memory: don't flood the channel with the whole feed
  let seeded = !firstRun;
  while (true) {
    const t0 = Date.now();
    try {
      const h: Record<string, string> = { "User-Agent": "Mozilla/5.0 (InstantNews)", Accept: "application/rss+xml, application/xml;q=0.9, */*;q=0.8" };
      if (etag) h["If-None-Match"] = etag;
      if (lastMod) h["If-Modified-Since"] = lastMod;
      const r = await fetch(FEED_URL, { signal: tmo(8000), headers: h });
      stats.polls++; stats.lastPoll = new Date().toISOString();
      if (r.status === 429) {
        stats.http429++; feedStat.r429++; okStreak = 0;
        feedStat.last429 = new Date().toISOString();
        const ra = Number(r.headers.get("retry-after") || 0);
        if (!feedStat.headers429) { feedStat.headers429 = JSON.stringify(Object.fromEntries(r.headers)).slice(0, 600); log("429 headers", feedStat.headers429); }
        feedStat.floor = Math.min(60_000, Math.max(feedStat.floor, Math.round(interval * 1.25)));
        interval = Math.min(Math.max(interval * 2, ra * 1000, feedStat.floor), 120_000);
        log("429 from feed, interval ->", interval, "floor", feedStat.floor);
      } else if (r.status === 304) {
        health.feedOkAt = Date.now(); feedStat.notModified++; okStreak++;
      } else if (r.ok) {
        health.feedOkAt = Date.now(); feedStat.ok++; okStreak++;
        etag = r.headers.get("etag") || ""; lastMod = r.headers.get("last-modified") || "";
        await handleFeed(await r.text(), !seeded);
        if (!seeded) { seeded = true; log("seeded current feed items (not posted)"); }
      } else log("feed status", r.status);
      if (okStreak > 0 && interval > feedStat.floor) interval = Math.max(feedStat.floor, Math.round(interval * 0.8)); // recover quickly to the safe floor
      if (okStreak >= 150 && feedStat.floor > POLL_MS) { feedStat.floor = Math.max(POLL_MS, feedStat.floor - 500); okStreak = 0; } // long calm stretch: try a bit faster
    } catch (e) { stats.errors++; log("poll error", String(e)); }
    if (feedStat.floor !== savedFloor) { savedFloor = feedStat.floor; kvSet("feed_floor", String(savedFloor)); }
    stats.interval = interval;
    await Bun.sleep(Math.max(250, interval - (Date.now() - t0)));
  }
}

// ---------------------------------------------------------------- scheduled posts
async function runDigest(force = false) {
  const day = localDay();
  if (!force && mem.kv.get("digest_day") === day) return;
  const heads = [...new Set(await todaysHeadlines())].slice(-250);
  const list = heads.length ? heads.map((h, i) => `${i + 1}. ${h}`).join("\n") : "(no headlines stored today — use the biggest market/geopolitical stories you are confident happened today, otherwise general market themes)";
  const out = await claude(
    `From these news headlines, pick the 5 most important (most important first) and write a brief daily digest. You MUST always return exactly 5 items, even on a quiet day. Format EXACTLY like this (no intro, no markdown):
1️⃣ [headline] — [one sentence analysis]

2️⃣ [headline] — [one sentence analysis]

3️⃣ [headline] — [one sentence analysis]

4️⃣ [headline] — [one sentence analysis]

5️⃣ [headline] — [one sentence analysis]

Headlines:
${list}`,
    1000, 30000,
  );
  if (!out) {
    log("digest: Claude returned nothing");
    if (!force && giveUp("digest")) { await kvSet("digest_day", day); await adminSay("🔴 Dnešný digest sa nepodarilo vytvoriť (Claude 3× neodpovedal). Skús neskôr /digest."); }
    return;
  }
  await kvSet("digest_day", day);
  const items = out.split(/\n+(?=[1-5]️⃣)/).map((s) => s.trim()).filter(Boolean);
  if (db) await db`INSERT INTO digest (content, headlines) VALUES (${items.join("\n\n")}, ${heads.join("\n")})`.catch((e) => log("db digest", String(e)));
  const text = `📰 WHAT HAPPENED TODAY?\n\n${items.slice(0, 3).join("\n\n")}`; // web gets 5, Telegram/X get top 3
  const img = pngMedia(await image("DIGEST"));
  const tg = await tgMedia(img, text);
  await tgPin(tg?.result?.message_id);
  await xPost(text, img, true);
  log("digest posted");
}

type CalEvent = { title: string; country: string; date: string; impact: string; forecast: string; previous: string };
let calCache: { at: number; events: CalEvent[] } = { at: 0, events: [] };
let calOkAt = 0; // last successful calendar download
const attempts = new Map<string, number>();
const giveUp = (job: string) => { const k = `${job}:${localDay()}`; const n = (attempts.get(k) || 0) + 1; attempts.set(k, n); return n >= 3; }; // scheduled jobs retry up to 3x
async function calendarEvents(): Promise<CalEvent[]> {
  if (Date.now() - calCache.at < 60 * 60_000 && calCache.events.length) return calCache.events; // source allows only a few requests per hour
  try {
    const r = await fetch(E.CAL_URL || "https://nfs.faireconomy.media/ff_calendar_thisweek.json", { signal: tmo(15_000), headers: { "User-Agent": "Mozilla/5.0" } });
    if (r.ok) { calCache = { at: Date.now(), events: await r.json() }; calOkAt = Date.now(); }
    else { log("calendar fetch", r.status); calCache.at = Date.now() - 50 * 60_000; } // retry in ~10 min
  } catch (e) { log("calendar error", String(e)); calCache.at = Date.now() - 50 * 60_000; }
  return calCache.events;
}
const usHigh = (evs: CalEvent[]) => evs.filter((e) => e.country === "USD" && e.impact === "High");
const etTime = (iso: string) => new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
const etDay = (iso: string) => new Date(iso).toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric" });
const fcLine = (e: CalEvent) => [e.forecast && `Forecast: ${e.forecast}`, e.previous && `Previous: ${e.previous}`].filter(Boolean).join(" | ");

async function runCalendar(force = false) {
  const day = localDay();
  const p = localParts();
  if (!force && (mem.kv.get("cal_day") === day || p.weekday === "Sat" || p.weekday === "Sun")) return;
  const all = await calendarEvents();
  if (Date.now() - calOkAt > 6 * 3600_000) return log("calendar: source not reachable, will retry"); // do not mark the day as done on stale data
  await kvSet("cal_day", day);
  const todayEt = etDay(new Date().toISOString());
  const ev = usHigh(all).filter((e) => etDay(e.date) === todayEt);
  if (!ev.length) return log("calendar: no high impact US events today");
  const lines = ev.map((e) => `🔴 ${etTime(e.date)} ET — ${e.title}${fcLine(e) ? "\n" + fcLine(e) : ""}`);
  const text = `📅 HIGH IMPACT NEWS TODAY\n\n${lines.join("\n\n")}`;
  await Promise.all([tgText(text), xPost(text, null, true)]);
  log("calendar posted");
}

// ⏰ 5-minute countdown before high-impact US data
async function runCountdown() {
  const now = Date.now();
  const soon = usHigh(await calendarEvents()).filter((e) => { const t = Date.parse(e.date) - now; return t > 0 && t <= 5 * 60_000 && !/All Day|Tentative/i.test(e.date); });
  const groups = new Map<string, CalEvent[]>();
  for (const e of soon) { const k = `cd:${e.date}`; if (!mem.kv.has(k)) groups.set(k, [...(groups.get(k) || []), e]); }
  for (const [k, evs] of groups) {
    await kvSet(k, "1");
    const mins = Math.max(1, Math.round((Date.parse(evs[0].date) - now) / 60_000));
    const text = `⏰ IN ${mins} MINUTE${mins > 1 ? "S" : ""} (${etTime(evs[0].date)} ET)\n\n` + evs.map((e) => `🇺🇸 ${e.title}${fcLine(e) ? "\n" + fcLine(e) : ""}`).join("\n\n");
    await Promise.all([tgText(text), xPost(text, null, true)]);
    log("countdown posted", evs.map((e) => e.title).join(", "));
  }
}
const fomcWindow = () => calCache.events.some((e) => e.country === "USD" && /FOMC|Federal Funds Rate/i.test(e.title) && Math.abs(Date.parse(e.date) - Date.now()) < 20 * 60_000);

// 🏦 Fed decisions straight from federalreserve.gov (polled every second around FOMC)
async function fedLoop() {
  let seeded = false;
  while (true) {
    try {
      const r = await fetch(FED_RSS + (FED_RSS.includes("?") ? "&" : "?") + "t=" + Date.now(), { signal: tmo(8000), headers: { "User-Agent": "Mozilla/5.0 (InstantNews)" } });
      if (r.ok) {
        for (const it of parseFeed(await r.text())) {
          const k = `fed:${it.guid || it.link}`;
          if (mem.seen.has(k)) continue;
          await markSeen([k]);
          if (!seeded || Date.now() - it.pubDate > 30 * 60_000) continue;
          if (!/FOMC statement|federal funds rate|monetary policy/i.test(it.title)) continue;
          const pg = await fetch(it.link, { signal: tmo(8000), headers: { "User-Agent": "Mozilla/5.0" } }).then((x) => x.text()).catch(() => "");
          const txt = htmlToText(pg).replace(/\s+/g, " ");
          const m = txt.match(/decided to (maintain|lower|raise) the target range for the federal funds rate(?: by [^,.]+?)? (?:at|to) ([0-9\-–/ ]+(?:to [0-9\-–/ ]+)?percent)/i);
          const verb = m ? ({ maintain: "Fed holds rates at", lower: "Fed cuts rates to", raise: "Fed raises rates to" } as any)[m[1].toLowerCase()] : null;
          const pctv = (x: string) => { const q = x.trim().match(/^(\d+)(?:-(\d)\/(\d))?$/); return q ? (Number(q[1]) + (q[2] ? Number(q[2]) / Number(q[3]) : 0)).toFixed(2) + "%" : x.trim(); };
          const range = m ? m[2].replace(/\s*percent/i, "").split(/\s+to\s+/).map(pctv).join("–") : "";
          const title = verb ? `FOMC DECISION: ${verb} ${range}` : `FOMC: ${it.title}`;
          await handleItem({ guid: k, title, content: "", link: "", pubDate: Date.now() }, { via: "fed", alert: true, sourceName: "Federal Reserve" });
        }
        seeded = true;
      }
    } catch (e) { log("fed poll error", String(e)); }
    await Bun.sleep(fomcWindow() ? 1000 : 60_000);
  }
}

// 📈 Sunday NQ week ahead: CFTC + Friday MOC + next week's US data
async function runWeekly(force = false) {
  const p = localParts();
  if (!force && (p.weekday !== "Sun" || mem.kv.get("weekly_day") === localDay())) return;
  let cftc = "", moc = "";
  if (db) {
    const c = await db`SELECT claude_analysis, data FROM cftc ORDER BY id DESC LIMIT 1`.catch(() => []);
    if (c[0]) cftc = c[0].claude_analysis || JSON.stringify(c[0].data);
    const m = await db`SELECT * FROM imbalances WHERE type = 'MOC' ORDER BY id DESC LIMIT 1`.catch(() => []);
    if (m[0]) moc = `S&P ${m[0].sp500}m, Nasdaq ${m[0].nasdaq}m, Dow ${m[0].dow30}m, Mag7 ${m[0].mag7}m (${new Date(m[0].created_at).toDateString()})`;
  }
  const next = usHigh(await calendarEvents()).filter((e) => Date.parse(e.date) > Date.now()).map((e) => `${etDay(e.date)} ${etTime(e.date)} ET — ${e.title} (${fcLine(e) || "no forecast"})`);
  if (!cftc && !moc && !next.length) { await kvSet("weekly_day", localDay()); return log("weekly: no data"); }
  const out = await claude(
    `You write a Sunday "week ahead" post for Nasdaq 100 futures (NQ) traders on X and Telegram.

Data you may use (do not invent numbers that are not here):
CFTC positioning (latest): ${cftc || "n/a"}
Friday MOC imbalance ($ millions, negative = selling): ${moc || "n/a"}
High-impact US events this week: 
${next.join("\n") || "n/a"}

Format EXACTLY (no markdown, no hashtags):
📈 NASDAQ WEEK AHEAD

🏦 Positioning: [1-2 sentences on what big money is doing, with numbers]

🔔 Friday close: [1 sentence on the MOC flow]

📅 Key events:
[each important event on its own line: "Tue 8:30 ET — CPI (fc 0.3%)", max 6 lines]

⚠️ Biggest risk: [1 sentence]

Bottom line: [1-2 sentences, clear bias for NQ this week and what would change it] 📈 or 📉`,
    900, 60000, true,
  );
  if (!out) {
    log("weekly: Claude returned nothing");
    if (!force && giveUp("weekly")) { await kvSet("weekly_day", localDay()); await adminSay("🔴 Nedeľný NQ výhľad sa nepodarilo vytvoriť (Claude 3× neodpovedal). Skús neskôr /weekly."); }
    return;
  }
  await kvSet("weekly_day", localDay());
  if (db) await db`INSERT INTO weekly (content) VALUES (${out})`.catch((e) => log("db weekly", String(e)));
  await Promise.all([tgText(out), xPost(out, null, true)]);
  log("weekly posted");
}

async function scheduler() {
  while (true) {
    // a job is "due" for 45 min after its time (each runs once a day), so a restart at the wrong minute cannot make it skip a day
    const mins = (s: string) => { const [h, m] = s.split(":").map(Number); return h * 60 + m; };
    const due = (t: string) => { const d = mins(localHM()) - mins(t); return d >= 0 && d < 45; };
    const paused = mem.kv.get("paused") === "1"; // /pause stops scheduled posts too
    try {
      if (!paused && due(DIGEST_TIME)) await runDigest();
      if (!paused && due(CALENDAR_TIME)) await runCalendar();
      if (!paused && due(WEEKLY_TIME)) await runWeekly();
      if (due(BACKUP_TIME) && localParts().weekday === "Sun") await runBackup();
      if (!paused) await runCountdown();
    } catch (e) { log("scheduler error", String(e)); }
    await Bun.sleep(20_000);
  }
}

// ---------------------------------------------------------------- Telegram source channels (user account, push = instant)
const userbot = { status: TG_API_ID ? "starting" : "off (TG_API_ID not set)", sources: TG_SOURCES, received: 0, posted: 0 };
let tgc: TelegramClient | null = null;
let login: { phone?: string; hash?: string } = {};
const client = () => (tgc ||= ((globalThis as any).__tgc = new TelegramClient({ apiId: TG_API_ID, apiHash: TG_API_HASH, storage: new MemoryStorage(), logLevel: 2 } as any)));

const PROMO_RE = /(t\.me\/|https?:\/\/|join (us|our|now)|subscribe|follow us|turn on notifications|share this|^@\w+$|^➡️|^👉)/i;
const LEAD_RE = /^(?:[🚨⚡️🔴🟥‼️❗🔥📢🇺🇸\s]|BREAKING|JUST IN|NEW|UPDATE|DEVELOPING|ALERT|FLASH)+[:\-—]?\s*/iu;
// channel handle tags: "… UKRAINE (@FirstSquaw)", "via @FirstSquawk", a line that is only "@FirstSquaw"
const HANDLE_RE = /\s*[([]\s*(?:via\s+)?@\w{3,}\s*[)\]]|\s*(?:[-–—|]\s*)?(?:via\s+)?@\w{3,}\s*$/gi;
export function stripHandles(line: string) { return line.replace(HANDLE_RE, "").trim(); }
export function cleanChannelText(raw: string) {
  const lines = raw.split("\n").map((l) => stripHandles(l.trim())).filter((l) => l && !PROMO_RE.test(l));
  if (!lines.length) return { text: "", alert: false };
  const alert = /^\s*(?:🚨|‼️|BREAKING)/iu.test(lines[0]);
  lines[0] = lines[0].replace(LEAD_RE, "").trim();
  return { text: lines.filter(Boolean).join("\n").trim(), alert };
}

const albums = new Map<string, { msgs: any[]; timer: any }>();
function onChannelMessage(msg: any) {
  const chat = msg.chat;
  const uname = String(chat?.username || "").toLowerCase();
  if (!TG_SOURCES.includes(uname) && !TG_SOURCES.includes(String(chat?.id))) return;
  if (blockedSources.has(uname) || ((chat?.isFake || chat?.isScam) && !TG_TRUSTED.includes(uname))) return; // impersonation channel
  userbot.received++;
  if (msg.groupedId) { // album: wait until all parts arrive, then post once
    const k = `${chat.id}:${msg.groupedId}`;
    const a = albums.get(k) || { msgs: [], timer: null };
    a.msgs.push(msg);
    clearTimeout(a.timer);
    a.timer = setTimeout(() => { albums.delete(k); processChannelPost(a.msgs).catch((e) => log("tg post error", String(e))); }, 1500);
    albums.set(k, a);
  } else processChannelPost([msg]).catch((e) => log("tg post error", String(e)));
}

async function processChannelPost(msgs: any[]) {
  const first = msgs[0], chat = first.chat;
  const key = `tg:${chat.id}:${first.groupedId || first.id}`;
  if (mem.seen.has(key)) return;
  await markSeen([key]);
  const date = first.date instanceof Date ? first.date.getTime() : Date.now();
  if (Date.now() - date > MAX_AGE_MIN * 60_000) return;
  const textMsg = msgs.find((m) => (m.text || "").trim()) || first;
  const { text, alert } = cleanChannelText(textMsg.text || "");
  if (!text) return; // media without any caption has no context — skip
  let media: Media | null = null;
  const mm = msgs.find((m) => m.media && (m.media.type === "photo" || m.media.type === "video"));
  if (mm) {
    const size = Number(mm.media.fileSize || 0);
    if (mm.media.type === "photo" || size < 48 * 1024 * 1024) { // Telegram bots can upload max 50 MB
      try {
        const bytes = await client().downloadAsBuffer(mm.media);
        media = mm.media.type === "video" ? { bytes, kind: "video", mime: mm.media.mimeType || "video/mp4" } : { bytes, kind: "photo", mime: "image/jpeg" };
      } catch (e) { log("tg media download failed", String(e)); }
    }
  }
  const [title, ...rest] = text.split("\n");
  const it: Item = { guid: key, title: title.trim(), content: rest.join("\n").trim(), link: "", pubDate: date };
  userbot.posted++;
  await handleItem(it, { via: `tg:${chat.username || chat.id}`, sourceName: chat.title || chat.username, media, alert });
}

const blockedSources = new Set<string>();
// channels the owner explicitly chose to keep even though Telegram flags them (TG_TRUSTED=name1,name2)
const TG_TRUSTED = (E.TG_TRUSTED || "").split(",").map((s) => s.trim().replace(/^@/, "").toLowerCase()).filter(Boolean);
async function attachUserbot() {
  const c = client();
  for (const ch of TG_SOURCES) {
    const chat: any = await c.joinChat(ch).catch((e: any) => { log("join failed", ch, String(e?.message || e)); return null; });
    // Telegram marks impersonation channels as FAKE / SCAM — never repost from them
    if (chat && (chat.isFake || chat.isScam) && !TG_TRUSTED.includes(ch.toLowerCase())) {
      blockedSources.add(ch.toLowerCase());
      log("source blocked (Telegram marks it as", chat.isScam ? "SCAM" : "FAKE", "):", ch);
      await adminSay(`⚠️ Kanál @${ch} je v Telegrame označený ako ${chat.isScam ? "PODVOD" : "FALOŠNÝ"} — správy z neho NEPOSIELAM. Vyhoď ho z TG_SOURCES v Railway.`);
    }
  }
  c.onNewMessage.add(onChannelMessage);
  await c.startUpdatesLoop().catch(() => {});
  const me = await c.getMe();
  userbot.status = `listening as ${me.displayName} to ${TG_SOURCES.length} channel(s)`;
  log("userbot:", userbot.status);
}
async function startUserbot() {
  if (!TG_API_ID || !TG_API_HASH) return;
  const sess = mem.kv.get("tg_session");
  if (!sess) { userbot.status = "needs login: open /tg/login?token=ADMIN_TOKEN"; return log("userbot:", userbot.status); }
  // During a redeploy the old container still holds the Telegram session for a few seconds. Two connections with the
  // same session make Telegram kill it (AUTH_KEY_DUPLICATED), so wait until the old instance has shut down.
  userbot.status = "waiting for previous instance to stop";
  await Bun.sleep(Number(E.USERBOT_START_DELAY_MS || 30_000));
  try {
    await client().start({ session: sess } as any);
    await attachUserbot();
  } catch (e) { userbot.status = "login expired — open /tg/login?token=ADMIN_TOKEN (" + String(e).slice(0, 120) + ")"; log("userbot start failed", String(e)); }
}
async function finishLogin() {
  loginKey = ""; // the one-time link is used up
  await kvSet("tg_session", await client().exportSession());
  await attachUserbot();
}
const page = (body: string) => new Response(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>InstantNews login</title><body style="font-family:system-ui;background:#0a0a0b;color:#eee;max-width:420px;margin:40px auto;padding:0 16px">${body}</body>`, { headers: { "content-type": "text/html; charset=utf-8" } });
const form = (action: string, label: string, name: string, type = "text") => `<h2>InstantNews ⚡ Telegram</h2><form method=post action="${action}"><p>${label}</p><input name=${name} type=${type} required style="width:100%;padding:10px;font-size:16px"><p><button style="padding:10px 20px;font-size:16px">OK</button></p></form>`;
// one-time login link sent to the admin chat, so the admin password never has to be typed into a URL
let loginKey = "", loginKeyExp = 0;
function tgLoginLink() {
  loginKey = crypto.randomUUID().replace(/-/g, ""); loginKeyExp = Date.now() + 30 * 60_000;
  const host = E.RAILWAY_PUBLIC_DOMAIN || "localhost:" + (E.PORT || 3000);
  return `https://${host}/tg/login?token=${loginKey}`;
}
const isLoginKey = (t: string | null) => !!loginKey && t === loginKey && Date.now() < loginKeyExp;
async function tgLoginRoute(u: URL, req: Request): Promise<Response> {
  const t = encodeURIComponent(u.searchParams.get("token") || "");
  if (!TG_API_ID || !TG_API_HASH) return page("<p>Set TG_API_ID and TG_API_HASH in Railway first.</p>");
  try {
    if (u.pathname === "/tg/login" && req.method === "GET") {
      // start from a clean client: an old, revoked session must not be reused for the new login
      try { await tgc?.close(); } catch {}
      tgc = null as any; (globalThis as any).__tgc = null;
    }
    if (u.pathname === "/tg/login" && req.method === "GET") return page(form(`/tg/login?token=${t}`, "Telefónne číslo Telegram účtu (s predvoľbou, napr. +421…)", "phone", "tel"));
    const f = await req.formData();
    if (u.pathname === "/tg/login") {
      const phone = String(f.get("phone") || "").replace(/\s/g, "");
      const sent: any = await client().sendCode({ phone });
      if (!sent.phoneCodeHash) { await finishLogin(); return page("<p>✅ Prihlásené.</p>"); }
      login = { phone, hash: sent.phoneCodeHash };
      return page(form(`/tg/code?token=${t}`, "Kód, ktorý ti prišiel do Telegramu", "code"));
    }
    if (u.pathname === "/tg/code") {
      try { await client().signIn({ phone: login.phone!, phoneCodeHash: login.hash!, phoneCode: String(f.get("code") || "").trim() }); }
      catch (e: any) {
        if (String(e?.text || e).includes("SESSION_PASSWORD_NEEDED")) return page(form(`/tg/password?token=${t}`, "Heslo dvojstupňového overenia (2FA)", "password", "password"));
        throw e;
      }
      await finishLogin(); return page(`<p>✅ Prihlásené. ${userbot.status}</p>`);
    }
    if (u.pathname === "/tg/password") { await client().checkPassword(String(f.get("password") || "")); await finishLogin(); return page(`<p>✅ Prihlásené. ${userbot.status}</p>`); }
  } catch (e) { return page(`<p>❌ ${String(e).replace(/</g, "&lt;")}</p><p><a style="color:#f55" href="/tg/login?token=${t}">Skúsiť znova</a></p>`); }
  return new Response("not found", { status: 404 });
}

// ---------------------------------------------------------------- admin chat (private Telegram): alerts, backups, commands
const adminChat = () => mem.kv.get("admin_chat") || E.ADMIN_CHAT_ID || "";
async function adminSay(text: string) {
  const id = adminChat();
  if (!id || !TG_TOKEN || DRY_RUN) return log("[ADMIN]", text);
  await tgCall("sendMessage", { chat_id: id, text: text.slice(0, 4096), disable_web_page_preview: true });
}
function statusText() {
  const ago = (t: number) => (t ? Math.round((Date.now() - t) / 60_000) + " min" : "—");
  return [
    `⚡ InstantNews ${mem.kv.get("paused") === "1" ? "⏸ POZASTAVENÝ" : "✅ beží"}`,
    `Feed: posledný OK pred ${ago(health.feedOkAt)} (interval ${stats.interval / 1000}s, OK×${feedStat.ok + feedStat.notModified}, 429×${feedStat.r429})`,
    `Posty: ${stats.posted} od štartu, posledný pred ${ago(health.lastPostAt)}, preskočené ${stats.skipped}`,
    `Oneskorenie (priemer): ${stats.lastLatencies.length ? Math.round(stats.lastLatencies.reduce((a, b) => a + b, 0) / stats.lastLatencies.length) + " s" : "—"}`,
    `X: ${xEnabled ? `${X_MODE}, zostáva dnes ${xBudgetLeft()}/${X_DAILY_CAP}` : "vypnuté"}${health.xLastError ? ` | posledná chyba: ${health.xLastError}` : ""}`,
    `Claude: ${ANTHROPIC_KEY ? (health.claudeFails ? `❌ ${health.claudeLastError}` : "OK") : "chýba kľúč"}`,
    `TG kanály: ${userbot.status}`,
  ].join("\n");
}

const alerts = new Map<string, { since: number; lastSent: number }>();
async function setAlert(key: string, active: boolean, msg: string) {
  const a = alerts.get(key);
  if (active) {
    if (!a) { alerts.set(key, { since: Date.now(), lastSent: Date.now() }); return adminSay(`🔴 PROBLÉM: ${msg}`); }
    if (Date.now() - a.lastSent > 30 * 60_000) { a.lastSent = Date.now(); return adminSay(`🔴 STÁLE TRVÁ (${Math.round((Date.now() - a.since) / 60_000)} min): ${msg}`); }
  } else if (a) { alerts.delete(key); return adminSay(`✅ Vyriešené: ${msg.split(" — ")[0]}`); }
}
async function watchdog() {
  await Bun.sleep(120_000);
  while (true) {
    try {
      const p = localParts(), h = Number(p.hour);
      const weekdayMarket = !["Sat", "Sun"].includes(p.weekday) && h >= 14 && h < 22;
      await setAlert("feed", Date.now() - health.feedOkAt > 3 * 60_000, `FinancialJuice feed — neodpovedá ${Math.round((Date.now() - health.feedOkAt) / 60_000)} min`);
      await setAlert("quiet", weekdayMarket && mem.kv.get("paused") !== "1" && Date.now() - health.lastPostAt > 60 * 60_000, "Žiadne posty — už 60 min počas obchodných hodín nič neodišlo");
      await setAlert("x", xEnabled && health.xLastErrorAt > health.xLastOkAt && Date.now() - health.xLastErrorAt < 60 * 60_000, `X API — ${health.xLastError} (402 = minuli sa kredity, 401/403 = kľúče alebo práva)`);
      await setAlert("claude", health.claudeFails >= 3, `Anthropic API — ${health.claudeLastError} (skontroluj kredit na console.anthropic.com)`);
      await setAlert("tg", health.tgFails >= 3, `Telegram kanál — ${health.tgLastError}`);
      await setAlert("userbot", !!TG_API_ID && TG_SOURCES.length > 0 && /needs login|expired/.test(userbot.status), "Telegram účet nie je prihlásený (čítanie kanálov stojí) — pošli mi /tglogin a dostaneš prihlasovací odkaz");
    } catch (e) { log("watchdog error", String(e)); }
    await Bun.sleep(60_000);
  }
}

async function runBackup() {
  const id = adminChat();
  if (!db || !id || !TG_TOKEN || DRY_RUN) return log("backup skipped");
  if (mem.kv.get("backup_day") === localDay()) return;
  await kvSet("backup_day", localDay());
  const dump: any = {
    created: new Date().toISOString(),
    news: await db`SELECT * FROM news WHERE created_at > now() - interval '8 days' ORDER BY id`,
    imbalances: await db`SELECT * FROM imbalances ORDER BY id DESC LIMIT 200`,
    digest: await db`SELECT * FROM digest ORDER BY id DESC LIMIT 60`,
    cftc: await db`SELECT * FROM cftc ORDER BY id DESC LIMIT 60`,
    weekly: await db`SELECT * FROM weekly ORDER BY id DESC LIMIT 20`,
    pageviews: await db`SELECT * FROM pageviews WHERE day >= ${new Date(Date.now() - 60 * 86_400_000).toISOString().slice(0, 10)}`,
    kv: (await db`SELECT * FROM kv`).filter((r: any) => r.k !== "tg_session"),
  };
  const gz = Bun.gzipSync(new TextEncoder().encode(JSON.stringify(dump)));
  const fd = new FormData();
  fd.append("chat_id", id);
  fd.append("document", new Blob([gz], { type: "application/gzip" }), `instantnews-backup-${localDay()}.json.gz`);
  fd.append("caption", `💾 Týždenná záloha InstantNews (${dump.news.length} správ)`);
  await tgCall("sendDocument", fd);
  log("backup sent");
}

async function adminLoop() {
  if (!TG_TOKEN || DRY_RUN) return;
  let offset = Number(mem.kv.get("tg_offset") || 0);
  await tgCall("deleteWebhook", {}); // a webhook left over from the old n8n setup would block commands
  while (true) {
    try {
      const r: any = await fetch(tgApi("getUpdates") + `?timeout=50&offset=${offset}&allowed_updates=${encodeURIComponent('["message"]')}`, { signal: tmo(65_000) }).then((x) => x.json());
      if (!r.ok) { log("admin getUpdates", JSON.stringify(r).slice(0, 200)); await Bun.sleep(5000); continue; }
      for (const u of r.result || []) {
        offset = u.update_id + 1;
        await kvSet("tg_offset", String(offset));
        const m = u.message;
        if (!m?.text || m.chat?.type !== "private") continue;
        const chat = String(m.chat.id), txt = m.text.trim(), isAdmin = chat === adminChat();
        const reply = (t: string) => tgCall("sendMessage", { chat_id: chat, text: t });
        if (txt.startsWith("/admin ")) {
          if (ADMIN_TOKEN && txt.slice(7).trim() === ADMIN_TOKEN) { await kvSet("admin_chat", chat); await reply("✅ Si nastavený ako admin. Sem ti budú chodiť upozornenia a zálohy.\n\n/status — stav\n/pause — zastaviť postovanie\n/resume — spustiť\n/digest — poslať digest teraz\n/weekly — poslať NQ výhľad teraz\n/backup — záloha teraz\n/web — návštevnosť webu\n/tglogin — prihlásiť Telegram účet\n/reply ID text — odpovedať na správu"); }
          else await reply("❌ Nesprávny kód.");
          continue;
        }
        if (!isAdmin) { // public contact channel: forward to the admin, thank the sender
          if (adminChat()) {
            await tgCall("forwardMessage", { chat_id: adminChat(), from_chat_id: chat, message_id: m.message_id });
            await adminSay(`✉️ Správa od ${m.from?.username ? "@" + m.from.username : m.from?.first_name || "?"} — odpovieš takto:\n/reply ${chat} tvoj text`);
          }
          await reply(txt === "/start" ? "⚡ InstantNews — breaking news on @FastestNewsFeed\n\nWrite us a message here and we will get back to you." : "✅ Thanks, we got your message and will reply here.");
          continue;
        }
        if (txt === "/status" || txt === "/start") await reply(statusText());
        else if (txt === "/pause") { await kvSet("paused", "1"); await reply("⏸ Postovanie pozastavené. /resume ho spustí."); }
        else if (txt === "/resume") { await kvSet("paused", "0"); await reply("▶️ Postovanie znova beží."); }
        else if (txt === "/digest") { await reply("Posielam digest…"); await runDigest(true); }
        else if (txt === "/weekly") { await reply("Posielam NQ výhľad…"); await runWeekly(true); }
        else if (txt === "/backup") { await kvSet("backup_day", ""); await runBackup(); }
        else if (txt.startsWith("/reply ")) {
          const [, to, ...rest] = txt.split(" ");
          const r = await tgCall("sendMessage", { chat_id: to, text: rest.join(" ") });
          await reply(r?.ok ? "✅ Odoslané." : "❌ Nepodarilo sa odoslať: " + (r?.description || ""));
        }
        else if (txt === "/tglogin") {
          if (!TG_API_ID || !TG_API_HASH) await reply("Najprv nastav TG_API_ID a TG_API_HASH v Railway.");
          else await reply(`🔐 Prihlásenie Telegram účtu (odkaz platí 30 min, len pre teba):\n${tgLoginLink()}\n\nZadaj číslo, potom kód z Telegramu (a heslo, ak máš dvojstupňové overenie).`);
        }
        else if (txt === "/web") {
          const rows = db ? await db`SELECT day, sum(views)::int AS v FROM pageviews WHERE day >= ${new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10)} GROUP BY day ORDER BY day DESC` : [];
          const top = db ? await db`SELECT path, sum(views)::int AS v FROM pageviews WHERE day = ${localDay()} GROUP BY path ORDER BY v DESC LIMIT 5` : [];
          await reply(`🌐 Návštevnosť webu (bez cookies)\n\n${rows.map((r: any) => `${r.day}: ${r.v}`).join("\n") || "zatiaľ nič"}${top.length ? `\n\nDnes najviac:\n${top.map((r: any) => `${r.path} — ${r.v}`).join("\n")}` : ""}`);
        }
        else await reply("Príkazy: /status /pause /resume /digest /weekly /backup /web /tglogin /reply");
      }
    } catch (e) { log("admin loop error", String(e)); await Bun.sleep(5000); }
  }
}

// ---------------------------------------------------------------- HTTP (status + manual tests)
function server() {
  Bun.serve({
    port: Number(E.PORT || 3000),
    async fetch(req) {
      const u = new URL(req.url);
      const authed = (ADMIN_TOKEN && u.searchParams.get("token") === ADMIN_TOKEN) || (u.pathname.startsWith("/tg/") && isLoginKey(u.searchParams.get("token")));
      if (u.pathname.startsWith("/api/") || u.pathname === "/health") {
        const cors = { "Access-Control-Allow-Origin": "*" };
        if (u.pathname === "/health") return Response.json({ status: "ok", timestamp: new Date().toISOString() }, { headers: cors });
        if (!db) return Response.json({ success: true, data: [] }, { headers: cors });
        const lim = (d: number) => Math.min(Math.max(parseInt(u.searchParams.get("limit") || "") || d, 1), 200);
        try {
          let rows: any;
          const cat = u.searchParams.get("category") || u.searchParams.get("cat");
          const type = u.searchParams.get("type")?.toUpperCase();
          const before = parseInt(u.searchParams.get("before") || "") || 2147483647;
          const q = (u.searchParams.get("q") || "").trim().slice(0, 80);
          const like = q ? `%${q.replace(/[\\%_]/g, (c) => "\\" + c)}%` : "%";
          const alertsOnly = u.searchParams.get("alert") === "1";
          switch (u.pathname) {
            case "/api/news": rows = await db`SELECT id, headline, content, category, ticker, high_alert, source, kind, created_at FROM news
              WHERE id < ${before} AND (${!cat || cat === "all"} OR category = ${cat}) AND (${!alertsOnly} OR high_alert)
              AND (headline ILIKE ${like} OR coalesce(content, '') ILIKE ${like}) ORDER BY id DESC LIMIT ${lim(20)}`; break;
            case "/api/stats": {
              const day = localDay();
              const [t] = await db`SELECT count(*)::int AS today, count(*) FILTER (WHERE high_alert)::int AS alerts_today, max(created_at) AS last_at FROM news WHERE day = ${day}`;
              const [w] = await db`SELECT count(*)::int AS week FROM news WHERE created_at > now() - interval '7 days'`;
              const lat = stats.lastLatencies;
              return Response.json({ success: true, data: { ...t, ...w, avg_latency_sec: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null, online: Date.now() - health.feedOkAt < 5 * 60_000 } }, { headers: cors });
            }
            case "/api/calendar": {
              const evs = (await calendarEvents()).filter((e) => e.country === "USD" && (e.impact === "High" || e.impact === "Medium"));
              return Response.json({ success: true, data: evs.map((e) => ({ title: e.title, date: e.date, impact: e.impact, forecast: e.forecast || null, previous: e.previous || null })) }, { headers: { ...cors, "Cache-Control": "public, max-age=300" } });
            }
            case "/api/weekly": rows = await db`SELECT * FROM weekly ORDER BY id DESC LIMIT ${lim(1)}`; break;
            case "/api/hit": { // privacy-friendly page counter: no cookies, no IP, only day + path
              const path = (u.searchParams.get("p") || "/").replace(/[^a-z0-9/._-]/gi, "").slice(0, 60) || "/";
              await db`INSERT INTO pageviews (day, path, views) VALUES (${localDay()}, ${path}, 1) ON CONFLICT (day, path) DO UPDATE SET views = pageviews.views + 1`.catch(() => {});
              return new Response(null, { status: 204, headers: cors });
            }
            case "/api/imbalances": rows = type ? await db`SELECT * FROM imbalances WHERE type = ${type} ORDER BY id DESC LIMIT ${lim(10)}` : await db`SELECT * FROM imbalances ORDER BY id DESC LIMIT ${lim(10)}`; break;
            case "/api/imbalances/today": rows = await db`SELECT * FROM imbalances WHERE created_at >= now() - interval '24 hours' ORDER BY id DESC`; break;
            case "/api/digest": rows = await db`SELECT * FROM digest ORDER BY id DESC LIMIT ${lim(7)}`; break;
            case "/api/cftc": rows = await db`SELECT * FROM cftc ORDER BY id DESC LIMIT ${lim(4)}`; break;
            default: return Response.json({ success: false, error: "not found" }, { status: 404, headers: cors });
          }
          return Response.json({ success: true, data: [...rows] }, { headers: cors });
        } catch (e) { return Response.json({ success: false, error: String(e) }, { status: 500, headers: cors }); }
      }
      if (u.pathname === "/") {
        const lat = stats.lastLatencies;
        return Response.json({ ...stats, feed: feedStat, avgLatencySec: lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : null, xEnabled, xKeys: X_KEYS_SHAPE, xLastError: health.xLastError || null, telegramSources: { ...userbot, hashFormatOk: TG_HASH_LOOKS_OK, hashLength: TG_API_HASH.length }, xMode: X_MODE, xPostsLeftToday: xBudgetLeft(), dryRun: DRY_RUN, claude: !!ANTHROPIC_KEY, telegram: !!TG_TOKEN, db: !!db });
      }
      if (!authed) return new Response("forbidden", { status: 403 });
      if (u.pathname.startsWith("/tg/")) return tgLoginRoute(u, req);
      if (u.pathname === "/test") { // /test?token=..&title=..&content=..
        const it: Item = { guid: "test-" + Date.now(), title: u.searchParams.get("title") || "Test headline", content: (u.searchParams.get("content") || "").replace(/\\n/g, "\n"), link: "", pubDate: Date.now() };
        await handleItem(it, { via: "test" });
        return new Response("ok\n" + JSON.stringify(classify(it)));
      }
      if (u.pathname === "/digest") { await runDigest(true); return new Response("digest done"); }
      if (u.pathname === "/calendar") { await runCalendar(true); return new Response("calendar done"); }
      if (u.pathname === "/weekly") { await runWeekly(true); return new Response("weekly done"); }
      return new Response("not found", { status: 404 });
    },
  });
}

// ---------------------------------------------------------------- start
if (import.meta.main && !E.NO_START) {
  log(`InstantNews v2 starting | X:${xEnabled ? X_MODE : "off"} | Claude:${!!ANTHROPIC_KEY} | TG:${!!TG_TOKEN} | dry:${DRY_RUN}`);
  await dbInit().catch((e) => log("DB init failed, memory only", String(e)));
  server();
  image("MOO"); image("MOC"); image("DIGEST");
  scheduler();
  startUserbot();
  fedLoop();
  adminLoop();
  watchdog();
  calendarEvents();
  adminSay("🟢 InstantNews spustený.\n\n" + statusText());
  await pollLoop();
}
