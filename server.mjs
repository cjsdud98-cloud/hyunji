/**
 * 네이버 지역 검색(Open API) 프록시 + 정적 파일 서빙
 * 사용: node server.mjs 후 http://localhost:8787 접속
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readNaverConfig, handleNearby } from "./functions/_shared/nearby-api.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8787;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

function loadLocalNaverConfig() {
  return readNaverConfig({
    env: process.env,
    readConfigFile: () => {
      try {
        const p = path.join(__dirname, "naver-config.json");
        const raw = fs.readFileSync(p, "utf8");
        const j = JSON.parse(raw);
        const clientId = String(j.naverClientId || "")
          .trim()
          .replace(/^\uFEFF/, "");
        const clientSecret = String(j.naverClientSecret || "")
          .trim()
          .replace(/^\uFEFF/, "");
        if (!clientId || !clientSecret) return null;
        return { clientId, clientSecret };
      } catch {
        return null;
      }
    },
  });
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
      const lat = Number(url.searchParams.get("lat"));
      const lng = Number(url.searchParams.get("lng"));
      const hasGps = Number.isFinite(lat) && Number.isFinite(lng);
      const gpsSearch =
        url.searchParams.get("gpsSearch") === "1" || url.searchParams.get("gpsSearch") === "true";
      if (!region && !(hasGps && gpsSearch)) {
        sendJson(res, 400, {
          error: "MISSING_REGION",
          message: "검색할 지역을 입력하거나 「내 위치」를 눌러 주세요.",
          items: [],
        });
        return;
      }
      try {
        const cfg = loadLocalNaverConfig();
        const payload = await handleNearby(url, cfg);
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
  const c = loadLocalNaverConfig();
  if (c) {
    console.log(`[config] 네이버 API 키 로드됨 (Client ID ${c.clientId.length}자).`);
  } else {
    console.warn("[config] naver-config.json 또는 NAVER_CLIENT_ID/SECRET 이 필요합니다.");
  }
});
