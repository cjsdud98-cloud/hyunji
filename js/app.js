/** @typedef {{ lat: number, lng: number }} LatLng */
/** @typedef {{ rank?: number, title: string, category?: string, roadAddress?: string, address?: string, link?: string, description?: string, telephone?: string, distanceKm?: number|null }} PlaceRow */

/** @type {LatLng | null} */
let userPos = null;

/** 맛집별 댓글 저장 키 접두사 (localStorage) */
const COMMENT_PREFIX = "hyunjin-place-comments:";

/** 현재 모달에서 편집 중인 맛집 저장용 ID */
let currentPlaceStorageId = "";

const elRankList = document.getElementById("rank-list");
const elRankCount = document.getElementById("rank-count");
const btnRefresh = document.getElementById("btn-refresh-location");
const elRegion = document.getElementById("region-query");
const elRegionForm = document.getElementById("region-search-form");

const elDetailRoot = document.getElementById("place-detail-root");
const elDetailBackdrop = document.getElementById("place-detail-backdrop");
const elDetailClose = document.getElementById("place-detail-close");
const elDetailInfo = document.getElementById("place-detail-info");
const elPlaceForm = document.getElementById("place-comment-form");
const elPlaceNickname = document.getElementById("place-nickname");
const elPlaceBody = document.getElementById("place-comment-body");
const elPlaceCommentList = document.getElementById("place-comment-list");
const elPlaceCharLeft = document.getElementById("place-char-left");

function setLocationMessage(_text, _isError = false) {}

function formatKm(km) {
  if (km == null || Number.isNaN(km)) return "거리 미상";
  if (km < 1) return `${Math.round(km * 1000)}m`;
  return `${km.toFixed(2)}km`;
}

function formatTime(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return iso;
  }
}

/** 네이버 행 → localStorage용 안정적인 ID (해시) */
function makePlaceStorageId(/** @type {PlaceRow} */ r) {
  const raw = `${r.title || ""}\n${r.roadAddress || ""}\n${r.address || ""}\n${r.link || ""}`;
  let h = 5381;
  for (let i = 0; i < raw.length; i++) {
    h = Math.imul(h, 33) ^ raw.charCodeAt(i);
  }
  return `${COMMENT_PREFIX}${(h >>> 0).toString(16)}`;
}

function showRankingPlaceholder(message, isError = false) {
  elRankCount.textContent = "0곳";
  elRankList.innerHTML = "";
  const p = document.createElement("p");
  p.className = "empty-state";
  p.textContent = message;
  elRankList.appendChild(p);
  if (isError) setLocationMessage(message, true);
}

function distanceBasisLabel(basis) {
  if (basis === "gps") return "내 위치 기준";
  if (basis === "region_geocode") return "검색 지역 중심";
  return "기본 좌표 기준";
}

function loadCommentsForPlace(storageId) {
  try {
    const raw = localStorage.getItem(storageId);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveCommentsForPlace(storageId, items) {
  localStorage.setItem(storageId, JSON.stringify(items));
}

function renderPlaceComments() {
  if (!elPlaceCommentList || !currentPlaceStorageId) return;
  const items = loadCommentsForPlace(currentPlaceStorageId).sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime()
  );
  elPlaceCommentList.innerHTML = "";

  if (items.length === 0) {
    const p = document.createElement("p");
    p.className = "empty-state";
    p.textContent = "아직 댓글이 없어요. 첫 후기를 남겨 보세요.";
    elPlaceCommentList.appendChild(p);
    return;
  }

  for (const c of items) {
    const li = document.createElement("li");
    li.className = "comment-item";
    const header = document.createElement("header");
    const author = document.createElement("span");
    author.className = "comment-author";
    author.textContent = c.nickname?.trim() ? c.nickname.trim() : "익명";
    const time = document.createElement("span");
    time.className = "comment-time";
    time.textContent = formatTime(c.at);
    header.append(author, time);
    const text = document.createElement("p");
    text.className = "comment-text";
    text.textContent = c.body;
    li.append(header, text);
    elPlaceCommentList.appendChild(li);
  }
}

/**
 * 상세 모달 열기 — 정보 + 해당 맛집 댓글
 * @param {PlaceRow} r
 * @param {string} distanceLabel
 */
function openPlaceDetail(r, distanceLabel) {
  currentPlaceStorageId = makePlaceStorageId(r);
  elDetailInfo.innerHTML = "";

  const title = document.createElement("h2");
  title.id = "place-detail-title";
  title.className = "place-detail-title";
  title.textContent = r.title || "(이름 없음)";

  const meta = document.createElement("p");
  meta.className = "place-detail-meta";
  meta.textContent = `${r.category || "지역"} · ${formatKm(r.distanceKm)} (${distanceLabel})`;

  const addrBlock = document.createElement("div");
  addrBlock.className = "place-detail-block";
  if (r.roadAddress) {
    const p1 = document.createElement("p");
    const lb1 = document.createElement("strong");
    lb1.textContent = "도로명 ";
    p1.append(lb1, document.createTextNode(r.roadAddress));
    addrBlock.appendChild(p1);
  }
  if (r.address && r.address !== r.roadAddress) {
    const p2 = document.createElement("p");
    const lb2 = document.createElement("strong");
    lb2.textContent = "지번 ";
    p2.append(lb2, document.createTextNode(r.address));
    addrBlock.appendChild(p2);
  }

  if (r.telephone) {
    const tel = document.createElement("p");
    tel.className = "place-detail-tel";
    const lb3 = document.createElement("strong");
    lb3.textContent = "전화 ";
    tel.append(lb3, document.createTextNode(r.telephone));
    addrBlock.appendChild(tel);
  }

  if (r.description) {
    const desc = document.createElement("p");
    desc.className = "place-detail-desc";
    desc.textContent = r.description;
    addrBlock.appendChild(desc);
  }

  if (r.link) {
    const ext = document.createElement("a");
    ext.href = r.link;
    ext.target = "_blank";
    ext.rel = "noopener noreferrer";
    ext.className = "btn-hero btn-hero--outline place-detail-naver";
    ext.textContent = "네이버에서 상세 보기";
    addrBlock.appendChild(ext);
  }

  elDetailInfo.append(title, meta, addrBlock);

  elPlaceNickname.value = "";
  elPlaceBody.value = "";
  if (elPlaceCharLeft) elPlaceCharLeft.textContent = "500";

  renderPlaceComments();

  elDetailRoot.hidden = false;
  document.body.classList.add("place-detail-open");
  elDetailClose.focus();
}

function closePlaceDetail() {
  elDetailRoot.hidden = true;
  document.body.classList.remove("place-detail-open");
  currentPlaceStorageId = "";
}

/**
 * @param {{ items: any[], distanceBasis?: string, localSearchError?: string }} data
 */
function renderNaverRanking(data) {
  const items = data.items || [];
  const basis = distanceBasisLabel(data.distanceBasis);
  elRankCount.textContent = `${items.length}곳`;
  elRankList.innerHTML = "";

  if (items.length === 0) {
    const isLocal =
      location.hostname === "localhost" || location.hostname === "127.0.0.1";
    const hint = data.localSearchError
      ? String(data.localSearchError)
      : isLocal
        ? "로컬: naver-config.json 에 네이버 Client ID·Secret 을 넣고 node server.mjs 를 실행했는지 확인하세요."
        : "배포: Cloudflare Pages → Settings → Environment variables 에 NAVER_CLIENT_ID, NAVER_CLIENT_SECRET 을 넣고 재배포하세요. /api/nearby 가 JSON 으로 응답하는지도 확인하세요.";
    const detail = `목록이 비었습니다.\n\n${hint}`;
    showRankingPlaceholder(detail, true);
    return;
  }

  items.forEach((r, idx) => {
    const li = document.createElement("li");
    li.className = "rank-item rank-item--clickable" + (idx < 3 ? " rank-item--top" : "");
    li.setAttribute("role", "button");
    li.setAttribute("tabindex", "0");
    li.setAttribute("aria-label", `${r.title || "맛집"} 상세 보기`);

    const rankNum = document.createElement("span");
    rankNum.className = "rank-num";
    rankNum.textContent = String(r.rank ?? idx + 1);

    const body = document.createElement("div");
    body.className = "rank-body";
    const h3 = document.createElement("h3");
    const titleSpan = document.createElement("span");
    titleSpan.className = "rank-title-text";
    titleSpan.textContent = r.title || "(이름 없음)";
    h3.appendChild(titleSpan);

    const meta = document.createElement("p");
    meta.className = "rank-meta";
    const addr = r.roadAddress || r.address || "";
    meta.textContent = `${r.category || "지역"} · ${formatKm(r.distanceKm)} · ${addr}`;

    body.append(h3, meta);

    const scores = document.createElement("div");
    scores.className = "rank-scores";
    const distLine = r.distanceKm != null ? `${formatKm(r.distanceKm)}` : "좌표 없음";
    scores.innerHTML = `<strong>${distLine}</strong>${basis}<br /><span class="rank-open-hint">상세</span>`;

    const open = () => openPlaceDetail(r, basis);
    li.addEventListener("click", open);
    li.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });

    li.append(rankNum, body, scores);
    elRankList.appendChild(li);
  });
}

async function loadRankingFromNaver() {
  const region = elRegion?.value?.trim() || "";
  if (!region) {
    setLocationMessage("검색할 지역을 입력한 뒤 「맛집 검색」을 눌러 주세요.", true);
    showRankingPlaceholder("지역 입력란이 비어 있습니다. 동·역·구 등 검색할 곳을 적어 주세요.");
    return;
  }

  elRankCount.textContent = "…";
  elRankList.innerHTML = "";
  const loading = document.createElement("p");
  loading.className = "empty-state";
  loading.textContent = "네이버 지역 검색 중…";
  elRankList.appendChild(loading);

  const params = new URLSearchParams();
  params.set("region", region);
  if (userPos) {
    params.set("lat", String(userPos.lat));
    params.set("lng", String(userPos.lng));
  }

  try {
    const res = await fetch(`/api/nearby?${params.toString()}`);
    const raw = await res.text();
    let data;
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch {
      const isLocal =
        location.hostname === "localhost" || location.hostname === "127.0.0.1";
      throw new Error(
        isLocal
          ? "API 응답이 JSON이 아닙니다. 터미널에서 node server.mjs 를 실행했는지 확인하세요."
          : "API(/api/nearby)가 동작하지 않습니다. Cloudflare Pages Functions 배포와 환경 변수(NAVER_CLIENT_ID, NAVER_CLIENT_SECRET)를 확인하세요."
      );
    }

    if (res.status === 400) {
      throw new Error(data.message || "검색할 지역을 입력해 주세요.");
    }
    if (!res.ok) {
      throw new Error(data.localSearchError || data.error || `HTTP ${res.status}`);
    }
    if (data.error && !data.items?.length) {
      throw new Error(data.localSearchError || data.error);
    }

    renderNaverRanking(data);
    setLocationMessage("", false);
  } catch (e) {
    const isLocal =
      location.hostname === "localhost" || location.hostname === "127.0.0.1";
    const msg =
      e instanceof TypeError && String(e).includes("fetch")
        ? isLocal
          ? "서버에 연결할 수 없습니다. node server.mjs 실행 후 http://localhost:8787 을 여세요."
          : "서버(API)에 연결할 수 없습니다. Cloudflare 배포 상태를 확인하세요."
        : String(e?.message || e);
    setLocationMessage(msg, true);
    showRankingPlaceholder(msg, true);
  }
}

function requestLocation() {
  setLocationMessage("내 위치를 가져오는 중…");
  if (!navigator.geolocation) {
    userPos = null;
    setLocationMessage("이 브라우저는 위치를 지원하지 않습니다. 지역명 검색만 사용할 수 있어요.", true);
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      userPos = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      const region = elRegion?.value?.trim();
      if (region) {
        setLocationMessage("내 위치를 받았습니다. 거리 반영을 위해 다시 검색합니다…");
        loadRankingFromNaver();
      } else {
        setLocationMessage("내 위치를 저장했습니다. 지역을 입력하고 「맛집 검색」하면 거리에 반영됩니다.");
      }
    },
    () => {
      userPos = null;
      setLocationMessage("위치 권한이 없습니다. 지역명만으로 검색할 수 있어요.", true);
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
}

elPlaceBody?.addEventListener("input", () => {
  const left = 500 - (elPlaceBody?.value.length || 0);
  if (elPlaceCharLeft) elPlaceCharLeft.textContent = String(Math.max(0, left));
});

elPlaceForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  const body = elPlaceBody?.value.trim();
  if (!body || !currentPlaceStorageId) return;

  const nickname = elPlaceNickname?.value || "";
  const next = [
    {
      id:
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `c-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
      nickname,
      body,
      at: new Date().toISOString(),
    },
    ...loadCommentsForPlace(currentPlaceStorageId),
  ];
  saveCommentsForPlace(currentPlaceStorageId, next);
  if (elPlaceBody) elPlaceBody.value = "";
  if (elPlaceCharLeft) elPlaceCharLeft.textContent = "500";
  renderPlaceComments();
});

elDetailClose?.addEventListener("click", closePlaceDetail);
elDetailBackdrop?.addEventListener("click", closePlaceDetail);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !elDetailRoot?.hidden) {
    closePlaceDetail();
  }
});

btnRefresh.addEventListener("click", requestLocation);
elRegionForm?.addEventListener("submit", (e) => {
  e.preventDefault();
  loadRankingFromNaver();
});

showRankingPlaceholder("위에 지역을 입력하고 「맛집 검색」을 누르면 네이버 지역 검색 결과가 여기에 표시됩니다.");
