/**
 * 네이버 지역 검색(Open API) 프록시 + 지오코딩(NCP, 거리 정렬용)
 * - 검색 지역(region) 필수
 * 사용: node server.mjs 후 http://localhost:8787 접속
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

function readNaverConfig() {
  const fromEnv = {
    clientId: String(process.env.NAVER_CLIENT_ID || "").trim(),
    clientSecret: String(process.env.NAVER_CLIENT_SECRET || "").trim(),
  };
  if (fromEnv.clientId && fromEnv.clientSecret) return fromEnv;

  try {
    const p = path.join(__dirname, "naver-config.json");
    const raw = fs.readFileSync(p, "utf8");
    const j = JSON.parse(raw);
    const id = String(j.naverClientId || "")
      .trim()
      .replace(/^\uFEFF/, "");
    const secret = String(j.naverClientSecret || "")
      .trim()
      .replace(/^\uFEFF/, "");
    if (!id || !secret) return null;
    return { clientId: id, clientSecret: secret };
  } catch {
    return null;
  }
}

function stripHtml(s) {
  return String(s || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .trim();
}

/**
 * 지역 검색 API mapx/mapy → WGS84 (문서상 정수, 실제 응답은 1e7 스케일 경위도인 경우가 많음)
 */
function mapxyToLatLng(mapx, mapy) {
  const x = Number(mapx);
  const y = Number(mapy);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const lng = x / 10_000_000;
  const lat = y / 10_000_000;
  if (lng >= 124 && lng <= 132 && lat >= 33 && lat <= 43) return { lat, lng };
  return null;
}

function distanceKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

/** @param {{ clientId: string, clientSecret: string }} cfg */
async function naverLocalSearch(cfg, query) {
  const u = new URL("https://openapi.naver.com/v1/search/local.json");
  u.searchParams.set("query", query);
  u.searchParams.set("display", "5");
  u.searchParams.set("start", "1");
  u.searchParams.set("sort", "comment");

  const res = await fetch(u.toString(), {
    headers: {
      "X-Naver-Client-Id": cfg.clientId,
      "X-Naver-Client-Secret": cfg.clientSecret,
      "User-Agent": "hyunjin-matjip/1.0 (nodejs)",
    },
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { parseError: true, body: text.slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, json };
}

/** @param {{ clientId: string, clientSecret: string }} cfg */
async function naverGeocode(cfg, address) {
  if (!address?.trim()) return null;
  const u = new URL("https://naveropenapi.apigw.ntruss.com/map-geocode/v2/geocode");
  u.searchParams.set("query", address.trim());

  const res = await fetch(u.toString(), {
    headers: {
      "X-NCP-APIGW-API-KEY-ID": cfg.clientId,
      "X-NCP-APIGW-API-KEY": cfg.clientSecret,
    },
  });
  if (!res.ok) return null;
  const j = await res.json();
  const a = j.addresses?.[0];
  if (!a) return null;
  const lng = Number(a.x);
  const lat = Number(a.y);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function buildSearchQueries(region) {
  const base = region.trim();
  const tails = ["맛집", "한식", "카페", "고기", "술집"];
  return tails.map((t) => `${base} ${t}`);
}

async function collectPlaces(cfg, queries, origin) {
  /** @type {Map<string, any>} */
  const map = new Map();
  /** @type {string | null} */
  let lastHttpError = null;

  for (const q of queries) {
    const { ok, status, json } = await naverLocalSearch(cfg, q);
    if (!ok) {
      lastHttpError =
        json?.errorMessage ||
        json?.message ||
        (typeof json?.errorCode === "string" ? `errorCode=${json.errorCode}` : null) ||
        `지역 검색 HTTP ${status}`;
      continue;
    }
    const rawItems = json?.items;
    if (!Array.isArray(rawItems) || rawItems.length === 0) {
      if (!lastHttpError) {
        lastHttpError = `네이버 응답에 결과가 없습니다. (total=${json?.total ?? "?"})`;
      }
      continue;
    }
    for (const it of rawItems) {
      const title = stripHtml(it.title);
      const key = `${title}|${it.roadAddress || it.address || ""}`;
      if (map.has(key)) continue;
      let pos = mapxyToLatLng(it.mapx, it.mapy);
      map.set(key, {
        key,
        title,
        category: it.category || "",
        roadAddress: it.roadAddress || "",
        address: it.address || "",
        link: it.link || "",
        description: stripHtml(it.description || ""),
        telephone: it.telephone || "",
        mapx: it.mapx,
        mapy: it.mapy,
        pos,
      });
    }
  }

  const list = [...map.values()];
  for (const p of list) {
    if (!p.pos && (p.roadAddress || p.address)) {
      // 좌표 보정: 주소 → NCP 지오코딩 (호출 한도 고려해 순차 처리)
      const addr = p.roadAddress || p.address;
      p.pos = await naverGeocode(cfg, addr);
    }
    if (p.pos) p.distanceKm = distanceKm(origin, p.pos);
    else p.distanceKm = null;
  }

  list.sort((a, b) => {
    const da = a.distanceKm ?? 1e9;
    const db = b.distanceKm ?? 1e9;
    return da - db;
  });

  const lastApiError = list.length === 0 ? lastHttpError : null;
  return { list, lastApiError };
}

async function handleNearby(url) {
  const region = (url.searchParams.get("region") || "").trim();
  if (!region) {
    throw new Error("검색 지역이 비어 있습니다.");
  }

  const qlat = Number(url.searchParams.get("lat"));
  const qlng = Number(url.searchParams.get("lng"));
  const hasGps = Number.isFinite(qlat) && Number.isFinite(qlng);

  const cfg = readNaverConfig();
  if (!cfg) {
    return {
      regionLabel: region,
      distanceBasis: "default_center",
      origin: { lat: 37.497952, lng: 127.027619 },
      localSearchError:
        "네이버 API 키가 설정되지 않았습니다. 로컬은 naver-config.json, 배포 환경은 NAVER_CLIENT_ID·NAVER_CLIENT_SECRET 환경 변수를 설정한 뒤 서버를 재시작해 주세요.",
      items: [],
      setupRequired: true,
    };
  }

  /** 거리 정렬 기준점: GPS가 있으면 내 위치, 없으면 검색 지역명 지오코딩 */
  let origin;
  /** @type {"gps" | "region_geocode" | "default_center"} */
  let distanceBasis;
  if (hasGps) {
    origin = { lat: qlat, lng: qlng };
    distanceBasis = "gps";
  } else {
    const g = await naverGeocode(cfg, region);
    if (g) {
      origin = g;
      distanceBasis = "region_geocode";
    } else {
      origin = { lat: 37.497952, lng: 127.027619 };
      distanceBasis = "default_center";
    }
  }

  const queries = buildSearchQueries(region);
  const { list: places, lastApiError } = await collectPlaces(cfg, queries, origin);

  const emptyFallback =
    "네이버에서 업체 목록을 받지 못했습니다. 개발자센터에서 새 애플리케이션을 만들고 「검색」→「지역 검색」을 켠 뒤, 표시되는 Client ID·Client Secret을 naver-config.json에 복사해 저장하세요. (잘못된 ID면 «Not Exist Client ID» 오류가 납니다.)";

  return {
    regionLabel: region,
    distanceBasis,
    origin,
    localSearchError: places.length === 0 ? lastApiError || emptyFallback : null,
    items: places.map((p, i) => ({
      rank: i + 1,
      title: p.title,
      category: p.category,
      roadAddress: p.roadAddress,
      address: p.address,
      link: p.link,
      description: p.description,
      telephone: p.telephone,
      distanceKm: p.distanceKm,
      lat: p.pos?.lat ?? null,
      lng: p.pos?.lng ?? null,
    })),
  };
}

function sendJson(res, status, obj) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(obj));
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || "application/octet-stream";
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": type });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://localhost:${PORT}`);

    if (url.pathname === "/api/nearby" && req.method === "GET") {
      const region = (url.searchParams.get("region") || "").trim();
      if (!region) {
        sendJson(res, 400, {
          error: "MISSING_REGION",
          message: "검색할 지역을 입력해 주세요.",
          items: [],
        });
        return;
      }
      try {
        const payload = await handleNearby(url);
        sendJson(res, 200, payload);
      } catch (e) {
        sendJson(res, 500, { error: String(e?.message || e) });
      }
      return;
    }

    const rel = (url.pathname.replace(/^\/+/, "") || "index.html").replace(/\\/g, "/");
    if (rel.includes("..") || rel.startsWith("/")) {
      res.writeHead(403);
      res.end();
      return;
    }
    const filePath = path.resolve(__dirname, rel);
    const root = path.resolve(__dirname);
    if (!filePath.startsWith(root + path.sep) && filePath !== root) {
      res.writeHead(403);
      res.end();
      return;
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    sendFile(res, filePath);
  } catch (e) {
    res.writeHead(500);
    res.end(String(e));
  }
});

server.listen(PORT, () => {
  console.log(`현지인 맛집 서버 실행 중: http://localhost:${PORT}`);
  const c = readNaverConfig();
  if (c) {
    console.log(`[config] naver-config.json 로드됨 (Client ID ${c.clientId.length}자). 저장 후 서버를 재시작했는지 확인하세요.`);
  } else {
    console.warn("[config] naver-config.json 에 Client ID/Secret 이 비어 있거나 파일을 읽을 수 없습니다.");
  }
});
