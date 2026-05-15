import { readNaverConfig, handleNearby } from "../_shared/nearby-api.mjs";

/** Cloudflare Pages Function → GET /api/nearby */
export async function onRequestGet(context) {
  const url = new URL(context.request.url);
  const region = (url.searchParams.get("region") || "").trim();

  if (!region) {
    return Response.json(
      {
        error: "MISSING_REGION",
        message: "검색할 지역을 입력해 주세요.",
        items: [],
      },
      { status: 400, headers: { "Cache-Control": "no-store" } }
    );
  }

  try {
    const cfg = readNaverConfig({ env: context.env });
    const payload = await handleNearby(url, cfg);
    return Response.json(payload, {
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "application/json; charset=utf-8",
      },
    });
  } catch (e) {
    const message = String(e?.message || e);
    return Response.json(
      {
        error: message,
        localSearchError: message,
        items: [],
      },
      { status: 500, headers: { "Cache-Control": "no-store" } }
    );
  }
}
