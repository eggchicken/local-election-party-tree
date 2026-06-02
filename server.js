import { readFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataFile = path.join(__dirname, "data", "candidates.json");
const port = Number(process.env.PORT || 5173);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const escapeRe = /&(amp|lt|gt|quot|apos|#39|#x27);/g;
const entities = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", "#39": "'", "#x27": "'" };
const pledgeTerms = /공약|정책|비전|발표|약속|계획/;

function decodeXml(value = "") {
  return value
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(escapeRe, (_, key) => entities[key] || _)
    .trim();
}

function stripTags(value = "") {
  return decodeXml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
}

function textBetween(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function normalizeTitle(title) {
  return title
    .replace(/\[[^\]]+\]|\([^)]*단독[^)]*\)|[〈《“”"']/g, " ")
    .replace(/\s+-\s+[^-]+$/g, " ")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\b(속보|단독|종합|인터뷰|영상|포토)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function similarity(a, b) {
  const as = new Set(normalizeTitle(a).split(" ").filter((x) => x.length > 1));
  const bs = new Set(normalizeTitle(b).split(" ").filter((x) => x.length > 1));
  if (!as.size || !bs.size) return 0;
  const intersection = [...as].filter((x) => bs.has(x)).length;
  return intersection / Math.max(as.size, bs.size);
}

function dedupeNews(items) {
  const clusters = [];
  for (const item of items) {
    const key = normalizeTitle(item.title);
    const existing = clusters.find((cluster) => cluster.key === key || similarity(cluster.title, item.title) > 0.72);
    if (existing) {
      existing.sources.push(item.source);
      if (new Date(item.publishedAt) > new Date(existing.publishedAt)) {
        existing.title = item.title;
        existing.link = item.link;
        existing.publishedAt = item.publishedAt;
      }
    } else {
      clusters.push({ ...item, key, sources: [item.source] });
    }
  }
  return clusters.map(({ key, ...item }) => ({
    ...item,
    sources: [...new Set(item.sources.filter(Boolean))]
  }));
}

function parseGoogleNewsRss(xml) {
  const blocks = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
  return blocks.map((block) => {
    const title = textBetween(block, "title");
    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);
    return {
      title: title.replace(/\s+-\s+[^-]+$/g, "").trim(),
      link: textBetween(block, "link"),
      source: sourceMatch ? decodeXml(sourceMatch[1]) : title.split(" - ").pop(),
      publishedAt: new Date(textBetween(block, "pubDate")).toISOString(),
      snippet: stripTags(textBetween(block, "description"))
    };
  });
}

async function getNews(url) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 CandidateNewsTree/1.0"
    }
  });
  if (!response.ok) throw new Error(`뉴스 요청 실패: ${response.status}`);
  return parseGoogleNewsRss(await response.text());
}

async function sendJson(res, body, status = 200) {
  res.writeHead(status, { "Content-Type": mime[".json"] });
  res.end(JSON.stringify(body));
}

async function routeApi(req, res, url) {
  if (url.pathname === "/api/candidates") {
    return sendJson(res, JSON.parse(await readFile(dataFile, "utf8")));
  }

  if (url.pathname === "/api/news") {
    const candidate = url.searchParams.get("candidate") || "";
    const race = url.searchParams.get("race") || "";
    const mode = url.searchParams.get("mode") || "recent";
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - 6);
    const ymd = (d) => d.toISOString().slice(0, 10);
    const dateQuery = mode === "older" ? `before:${ymd(cutoff)}` : `after:${ymd(cutoff)}`;
    const q = `"${candidate}" ${race} 지방선거 ${dateQuery}`;
    const rss = new URL("https://news.google.com/rss/search");
    rss.searchParams.set("q", q);
    rss.searchParams.set("hl", "ko");
    rss.searchParams.set("gl", "KR");
    rss.searchParams.set("ceid", "KR:ko");

    try {
      const items = dedupeNews(await getNews(rss));
      return sendJson(res, { query: q, mode, cutoff: ymd(cutoff), items });
    } catch (error) {
      return sendJson(res, { error: error.message, items: [] }, 502);
    }
  }

  if (url.pathname === "/api/pledges") {
    const candidate = url.searchParams.get("candidate") || "";
    const race = url.searchParams.get("race") || "";
    const now = new Date();
    const cutoff = new Date(now);
    cutoff.setMonth(cutoff.getMonth() - 6);
    const ymd = (d) => d.toISOString().slice(0, 10);
    const q = `"${candidate}" ${race} (공약 OR 정책 OR 비전 OR 발표) 지방선거 after:${ymd(cutoff)}`;
    const rss = new URL("https://news.google.com/rss/search");
    rss.searchParams.set("q", q);
    rss.searchParams.set("hl", "ko");
    rss.searchParams.set("gl", "KR");
    rss.searchParams.set("ceid", "KR:ko");

    try {
      const items = dedupeNews((await getNews(rss)).filter((item) => pledgeTerms.test(`${item.title} ${item.snippet}`))).slice(0, 8);
      return sendJson(res, { query: q, cutoff: ymd(cutoff), items });
    } catch (error) {
      return sendJson(res, { error: error.message, items: [] }, 502);
    }
  }

  return sendJson(res, { error: "Not found" }, 404);
}

async function routeStatic(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  try {
    const body = await readFile(filePath);
    res.writeHead(200, { "Content-Type": mime[path.extname(filePath)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end("Not found");
  }
}

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) return routeApi(req, res, url);
  return routeStatic(req, res, url);
}).listen(port, () => {
  console.log(`Local election party tree: http://localhost:${port}`);
});
