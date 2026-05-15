import { readNaverConfig, handleNearby } from "../../lib/nearby-api.mjs";

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
    return Response.json(payload, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return Response.json({ error: String(e?.message || e) }, { status: 500 });
  }
}
