const escapeRe = /&(amp|lt|gt|quot|apos|#39|#x27);/g;
const entities = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", "#39": "'", "#x27": "'" };
const pledgeTerms = /공약|정책|비전|발표|약속|계획/;

function decodeXml(value = "") {
  return value
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(escapeRe, (_, key) => entities[key] || _)
    .trim();
}

function textBetween(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? decodeXml(match[1]) : "";
}

function stripTags(value = "") {
  return decodeXml(value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " "));
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

function dedupe(items) {
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
        existing.source = item.source;
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

async function getRssItems(q) {
  const rss = new URL("https://news.google.com/rss/search");
  rss.searchParams.set("q", q);
  rss.searchParams.set("hl", "ko");
  rss.searchParams.set("gl", "KR");
  rss.searchParams.set("ceid", "KR:ko");
  const response = await fetch(rss, {
    headers: {
      "User-Agent": "Mozilla/5.0 CandidatePledgeTree/1.0"
    }
  });
  if (!response.ok) throw new Error(`공약 자료 요청 실패: ${response.status}`);
  return parseGoogleNewsRss(await response.text());
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const candidate = req.query.candidate || "";
  const race = req.query.race || "";
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setMonth(cutoff.getMonth() - 6);
  const after = cutoff.toISOString().slice(0, 10);
  const q = `"${candidate}" ${race} (공약 OR 정책 OR 비전 OR 발표) 지방선거 after:${after}`;

  try {
    const items = dedupe((await getRssItems(q)).filter((item) => pledgeTerms.test(`${item.title} ${item.snippet}`))).slice(0, 8);
    return res.status(200).json({ query: q, cutoff: after, items });
  } catch (error) {
    return res.status(502).json({ error: error.message, items: [] });
  }
}
