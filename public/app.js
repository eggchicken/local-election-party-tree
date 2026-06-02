const state = {
  candidates: [],
  selected: null,
  region: "전체",
  query: "",
  olderLoaded: false
};

const els = {
  metaLine: document.querySelector("#metaLine"),
  searchInput: document.querySelector("#searchInput"),
  regionFilters: document.querySelector("#regionFilters"),
  candidateList: document.querySelector("#candidateList"),
  raceLabel: document.querySelector("#raceLabel"),
  candidateName: document.querySelector("#candidateName"),
  candidateSummary: document.querySelector("#candidateSummary"),
  currentParty: document.querySelector("#currentParty"),
  partyTree: document.querySelector("#partyTree"),
  treeRange: document.querySelector("#treeRange"),
  historyCoverage: document.querySelector("#historyCoverage"),
  pledgeList: document.querySelector("#pledgeList"),
  pledgeHint: document.querySelector("#pledgeHint"),
  refreshPledges: document.querySelector("#refreshPledges"),
  newsList: document.querySelector("#newsList"),
  newsHint: document.querySelector("#newsHint"),
  refreshNews: document.querySelector("#refreshNews"),
  loadOlder: document.querySelector("#loadOlder")
};

function partyClass(party) {
  if (party.includes("민주")) return "party-dem";
  if (party.includes("국민의힘") || party.includes("한나라") || party.includes("새누리") || party.includes("자유한국")) return "party-ppp";
  return "party-other";
}

function formatYear(item) {
  return item.from === item.to ? `${item.from}` : `${item.from}-${item.to}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(new Date(value));
}

function filterCandidates() {
  const q = state.query.trim().toLowerCase();
  return state.candidates.filter((candidate) => {
    const regionOk = state.region === "전체" || candidate.region === state.region;
    const queryOk = !q || [candidate.name, candidate.region, candidate.race, candidate.currentParty]
      .join(" ")
      .toLowerCase()
      .includes(q);
    return regionOk && queryOk;
  });
}

function renderFilters() {
  const regions = ["전체", ...new Set(state.candidates.map((candidate) => candidate.region))];
  els.regionFilters.innerHTML = regions.map((region) => `
    <button class="filter ${region === state.region ? "active" : ""}" type="button" data-region="${region}">
      ${region}
    </button>
  `).join("");
}

function renderList() {
  const candidates = filterCandidates();
  els.candidateList.innerHTML = candidates.map((candidate) => `
    <button class="candidate-button ${state.selected?.id === candidate.id ? "active" : ""}" type="button" data-id="${candidate.id}">
      <span class="candidate-top">
        <strong>${candidate.name}</strong>
        <span class="party-pill ${partyClass(candidate.currentParty)}">${candidate.currentParty}</span>
      </span>
      <span class="candidate-meta">${candidate.region} · ${candidate.race}</span>
    </button>
  `).join("");
}

function renderCandidate(candidate) {
  state.selected = candidate;
  state.olderLoaded = false;
  els.raceLabel.textContent = `${candidate.region} · ${candidate.race}`;
  els.candidateName.textContent = candidate.name;
  els.candidateSummary.textContent = candidate.summary;
  els.currentParty.textContent = candidate.currentParty;
  const years = candidate.partyHistory.flatMap((item) => [item.from, item.to]);
  const firstYear = Math.min(...years);
  const lastYear = Math.max(...years);
  const hasOnlyCurrentRegistration = candidate.partyHistory.length === 1 && firstYear === 2026 && lastYear === 2026;
  const hasUnverifiedHistory = candidate.partyHistory.some((item) => item.kind === "unknown");
  els.treeRange.textContent = hasOnlyCurrentRegistration ? "2026년 후보 등록 정당" : `${firstYear}년부터 ${lastYear}년까지`;
  els.historyCoverage.textContent = hasOnlyCurrentRegistration
    ? "검증된 과거 당적 데이터가 아직 없어 현재 후보 등록 정당만 표시합니다."
    : hasUnverifiedHistory
      ? "일부 과거 당적 구간은 공개 자료 확인이 필요합니다."
    : "";
  els.partyTree.innerHTML = candidate.partyHistory.map((item) => `
    <div class="tree-row">
      <div class="year">${formatYear(item)}</div>
      <div class="node"></div>
      <div class="tree-card">
        <strong>${item.party}</strong>
        <span>${item.kind === "unknown" ? "과거 당적 확인 필요" : item.kind === "mixed" ? "정당/정치활동 혼재 구간" : "소속 정당"}</span>
      </div>
    </div>
  `).join("");
  renderList();
  loadPledges();
  loadNews("recent");
}

function renderPledges(items) {
  if (!items.length) {
    els.pledgeList.className = "pledge-list empty";
    els.pledgeList.textContent = "공약·정책 관련 출처를 찾지 못했습니다.";
    return;
  }

  els.pledgeList.className = "pledge-list";
  els.pledgeList.innerHTML = items.map((item) => `
    <article class="pledge-item">
      <a href="${item.link}" target="_blank" rel="noreferrer">${item.title}</a>
      <div class="pledge-source">
        <span>${formatDate(item.publishedAt)}</span>
        <a href="${item.link}" target="_blank" rel="noreferrer">${item.source}</a>
      </div>
    </article>
  `).join("");
}

async function loadPledges() {
  if (!state.selected) return;
  els.pledgeHint.textContent = "공약·정책 자료 수집 중";
  els.pledgeList.className = "pledge-list empty";
  els.pledgeList.textContent = "공약 자료를 불러오는 중입니다.";

  const params = new URLSearchParams({
    candidate: state.selected.name,
    race: state.selected.race
  });
  const response = await fetch(`/api/pledges?${params}`);
  const payload = await response.json();

  if (payload.error) {
    els.pledgeList.className = "pledge-list empty";
    els.pledgeList.textContent = `공약 자료를 가져오지 못했습니다: ${payload.error}`;
    els.pledgeHint.textContent = "공약·정책 출처";
    return;
  }

  renderPledges(payload.items);
  els.pledgeHint.textContent = `수집 출처 ${payload.items.length}건`;
}

function renderNews(items, mode) {
  if (!items.length && mode === "recent") {
    els.newsList.className = "news-list empty";
    els.newsList.textContent = "최근 6개월 관련 뉴스를 찾지 못했습니다. 더보기로 오래된 기사까지 확인할 수 있습니다.";
    els.loadOlder.hidden = false;
    return;
  }

  els.newsList.className = "news-list";
  const html = items.map((item) => `
    <article class="news-item">
      <a href="${item.link}" target="_blank" rel="noreferrer">${item.title}</a>
      <div class="news-source">
        <span>${formatDate(item.publishedAt)}</span>
        <span class="source-stack">${item.sources.length > 1 ? `${item.sources.length}개 언론사 묶음` : item.source}</span>
      </div>
      ${item.sources.length > 1 ? `<div class="news-source">언론사: ${item.sources.join(", ")}</div>` : ""}
    </article>
  `).join("");

  if (mode === "older") {
    els.newsList.insertAdjacentHTML("beforeend", html);
  } else {
    els.newsList.innerHTML = html;
  }
  els.loadOlder.hidden = state.olderLoaded;
}

async function loadNews(mode = "recent") {
  if (!state.selected) return;
  if (mode === "older") state.olderLoaded = true;
  els.newsHint.textContent = mode === "older" ? "6개월 이전 기사까지 확장 중" : "최근 6개월, 유사 기사 묶음";
  if (mode === "recent") {
    els.newsList.className = "news-list empty";
    els.newsList.textContent = "뉴스를 불러오는 중입니다.";
  } else {
    els.loadOlder.textContent = "불러오는 중";
    els.loadOlder.disabled = true;
  }

  const params = new URLSearchParams({
    candidate: state.selected.name,
    race: state.selected.race,
    mode
  });
  const response = await fetch(`/api/news?${params}`);
  const payload = await response.json();

  if (payload.error) {
    els.newsList.className = "news-list empty";
    els.newsList.textContent = `뉴스를 가져오지 못했습니다: ${payload.error}`;
    els.loadOlder.hidden = false;
  } else {
    renderNews(payload.items, mode);
    els.newsHint.textContent = mode === "older" ? "6개월 이전 기사 포함" : `최근 6개월 기준 · ${payload.items.length}건 묶음`;
  }
  els.loadOlder.textContent = "더보기";
  els.loadOlder.disabled = false;
}

function bindEvents() {
  els.regionFilters.addEventListener("click", (event) => {
    const button = event.target.closest("[data-region]");
    if (!button) return;
    state.region = button.dataset.region;
    renderFilters();
    renderList();
  });

  els.candidateList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-id]");
    if (!button) return;
    const candidate = state.candidates.find((item) => item.id === button.dataset.id);
    renderCandidate(candidate);
  });

  els.searchInput.addEventListener("input", (event) => {
    state.query = event.target.value;
    renderList();
  });

  els.refreshNews.addEventListener("click", () => loadNews("recent"));
  els.refreshPledges.addEventListener("click", () => loadPledges());
  els.loadOlder.addEventListener("click", () => loadNews("older"));
}

async function init() {
  const response = await fetch("/api/candidates");
  const payload = await response.json();
  state.candidates = payload.candidates;
  els.metaLine.textContent = `${payload.meta.election} · ${payload.meta.lastChecked} 기준`;
  renderFilters();
  renderList();
  renderCandidate(state.candidates[0]);
  bindEvents();
}

init();
