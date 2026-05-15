/**
 * 네이버 지역 검색·지오코딩 (Node / Cloudflare Pages Functions 공용)
 */

export function readNaverConfig(options = {}) {
  const { env, readConfigFile } = options;

  if (env) {
    const clientId = String(env.NAVER_CLIENT_ID || env.naverClientId || "").trim();
    const clientSecret = String(env.NAVER_CLIENT_SECRET || env.naverClientSecret || "").trim();
    if (clientId && clientSecret) return { clientId, clientSecret };
  }

  if (typeof readConfigFile === "function") {
    return readConfigFile();
  }

  return null;
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
      "User-Agent": "hyunjin-matjip/1.0",
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
  const map = new Map();
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
      const pos = mapxyToLatLng(it.mapx, it.mapy);
      map.set(key, {
        key,
        title,
        category: it.category || "",
        roadAddress: it.roadAddress || "",
        address: it.address || "",
        link: it.link || "",
        description: stripHtml(it.description || ""),
        telephone: it.telephone || "",
        pos,
      });
    }
  }

  const list = [...map.values()];
  for (const p of list) {
    if (!p.pos && (p.roadAddress || p.address)) {
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

  return { list, lastApiError: list.length === 0 ? lastHttpError : null };
}

/** @param {URL} url @param {{ clientId: string, clientSecret: string } | null} cfg */
export async function handleNearby(url, cfg) {
  const region = (url.searchParams.get("region") || "").trim();
  if (!region) {
    throw new Error("검색 지역이 비어 있습니다.");
  }

  const qlat = Number(url.searchParams.get("lat"));
  const qlng = Number(url.searchParams.get("lng"));
  const hasGps = Number.isFinite(qlat) && Number.isFinite(qlng);

  if (!cfg) {
    return {
      regionLabel: region,
      distanceBasis: "default_center",
      origin: { lat: 37.497952, lng: 127.027619 },
      localSearchError:
        "네이버 API 키가 없습니다.\n\n" +
        "【Cloudflare 배포】 Pages → Settings → Environment variables (Production)\n" +
        "· NAVER_CLIENT_ID\n· NAVER_CLIENT_SECRET\n" +
        "저장 후 Deployments에서 재배포하세요.\n\n" +
        "【로컬 개발】 naver-config.json 에 Client ID·Secret 입력 후 node server.mjs",
      items: [],
      setupRequired: true,
    };
  }

  let origin;
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
    "네이버에서 업체를 받지 못했습니다. 개발자센터에서 「검색」→「지역 검색」을 켠 Client ID·Secret이 맞는지 확인하세요.";

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
