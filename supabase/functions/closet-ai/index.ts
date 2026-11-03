// 온도 옷장 AI 기능: 사진 분석, 상품 링크 읽기, 코디 한마디.
// Supabase 대시보드 → Edge Functions 에서 이름을 "closet-ai" 로 만들고 이 파일 내용을 붙여넣어 배포하세요.
// 비밀값: ANTHROPIC_API_KEY (Edge Functions → Secrets)
import Anthropic from "npm:@anthropic-ai/sdk";

const MODEL = "claude-opus-5-5";
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

// Keys must match the catalog in index.html (TYPES / MATERIALS / COLORS).
const TYPES = ["tee_s", "tee_l", "shirt", "thermal", "sweat", "hood", "knit", "cardigan", "fleece", "vest", "windbreaker", "denim_jk", "blazer", "trench", "leather", "light_down", "coat", "short_down", "long_down", "shorts", "skirt", "slacks", "chino", "jeans", "lined_pants", "sneakers", "loafers", "sandals", "boots", "long_boots", "beanie", "beret", "cap", "scarf", "gloves", "bag"];
const MATERIALS = ["cotton", "linen", "poly", "nylon", "rayon", "denim", "acrylic", "wool", "cashmere", "fleece", "down", "leather"];
const COLORS = ["black", "white", "gray", "charcoal", "navy", "beige", "ivory", "denim", "brown", "khaki", "green", "blue", "skyblue", "red", "burgundy", "pink", "yellow", "purple"];
const TYPE_HELP = "tee_s=반팔티, tee_l=긴팔티, shirt=셔츠·블라우스, thermal=발열내의, sweat=맨투맨, hood=후드티, knit=니트, cardigan=가디건, fleece=플리스, vest=조끼, windbreaker=바람막이, denim_jk=데님자켓, blazer=블레이저, trench=트렌치코트, leather=가죽자켓, light_down=경량패딩, coat=코트, short_down=숏패딩, long_down=롱패딩, shorts=반바지, skirt=치마, slacks=슬랙스, chino=면바지, jeans=청바지, lined_pants=기모바지, sneakers=운동화, loafers=로퍼·구두, sandals=샌들, boots=앵클부츠, long_boots=롱부츠, beanie=비니, beret=베레모, cap=볼캡, scarf=목도리, gloves=장갑, bag=가방";
const ITEM_RULES = `brand: 브랜드 이름 (한국어 표기가 있으면 한국어, 예: "미세키서울". 모르면 "")
name: 브랜드와 색상을 뺀 상품 이름을 한국어로 짧게 (예: "언밸런스 카울 버튼 니트". 상품명이 없으면 "울 니트"처럼 종류 위주로)
type 뜻: ${TYPE_HELP}
material: 가장 비중이 큰 소재. 혼용률 표기가 없으면 질감이나 상품명으로 추정
thickness: thin(얇음) / normal(보통) / thick(두꺼움)`;

const itemProps = {
  brand: { type: "string" },
  name: { type: "string" },
  type: { type: "string", enum: TYPES },
  color: { type: "string", enum: COLORS },
  material: { type: "string", enum: MATERIALS },
  thickness: { type: "string", enum: ["thin", "normal", "thick"] },
};
const itemRequired = ["brand", "name", "type", "color", "material", "thickness"];

class ApiFail extends Error { constructor(public code: string) { super(code); } }

let client: Anthropic | null = null;
function claude() {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new ApiFail("not_configured");
  client ??= new Anthropic({ apiKey: key });
  return client;
}

// One request with a JSON-schema answer. fallbacks: "default" lets the API retry a refused request on another model.
async function ask(content: Anthropic.Beta.BetaContentBlockParam[], schema: Record<string, unknown>, effort: "low" | "medium") {
  let res;
  try {
    res = await claude().beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      // @ts-ignore: fallbacks "default" may be newer than the SDK's types
      fallbacks: "default",
      output_config: { effort, format: { type: "json_schema", schema } },
      messages: [{ role: "user", content }],
    });
  } catch (e) {
    if (e instanceof ApiFail) throw e;
    if (e instanceof Anthropic.RateLimitError) throw new ApiFail("rate_limited");
    if (e instanceof Anthropic.BadRequestError) { console.error("bad request", e.message); throw new ApiFail("image_rejected"); }
    console.error("claude error", e);
    throw new ApiFail("upstream_error");
  }
  if (res.stop_reason === "refusal") throw new ApiFail("refused");
  const text = res.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  try { return JSON.parse(text); } catch { throw new ApiFail("invalid_json"); }
}

async function analyzePhoto(image: string, mediaType: string) {
  if (!image || image.length > 7_000_000) throw new ApiFail("image_rejected");
  const schema = {
    type: "object", additionalProperties: false, required: ["items"],
    properties: {
      items: {
        type: "array",
        items: {
          type: "object", additionalProperties: false, required: [...itemRequired, "box"],
          properties: { ...itemProps, box: { type: "array", items: { type: "number" } } },
        },
      },
    },
  };
  return await ask([
    { type: "image", source: { type: "base64", media_type: mediaType as "image/jpeg", data: image } },
    { type: "text", text: `이 사진에 보이는 옷과 잡화(신발, 모자, 목도리, 장갑, 가방)를 모두 찾아 주세요. 여러 벌이면 각각 따로 적어 주세요. 사람이 입고 있어도 됩니다. 선글라스, 시계, 액세서리는 제외.
box는 그 물건만 딱 감싸는 사각형 [x0, y0, x1, y1]이고, 이미지 너비·높이 대비 0~1 비율이에요 (왼쪽 위가 0,0).
${ITEM_RULES}` },
  ], schema, "medium");
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
const meta = (html: string, key: string) =>
  html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]*content=["']([^"']+)`, "i"))?.[1] ||
  html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]*(?:property|name)=["']${key}["']`, "i"))?.[1] || "";
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");

async function fetchImage(url: string, referer: string) {
  try {
    const r = await fetch(url, { headers: { "User-Agent": UA, Referer: referer, Accept: "image/*" } });
    const type = (r.headers.get("content-type") || "").split(";")[0];
    if (!r.ok || !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(type)) return null;
    const buf = new Uint8Array(await r.arrayBuffer());
    if (buf.length < 2000 || buf.length > 4_500_000) return null;
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { type, data: btoa(bin) };
  } catch { return null; }
}

async function readLink(url: string) {
  let page: URL;
  try { page = new URL(url); } catch { throw new ApiFail("bad_url"); }
  if (!/^https?:$/.test(page.protocol)) throw new ApiFail("bad_url");
  let html = "";
  try {
    const r = await fetch(page, { headers: { "User-Agent": UA, "Accept-Language": "ko-KR,ko;q=0.9", Accept: "text/html" }, redirect: "follow" });
    if (!r.ok) throw new ApiFail("fetch_blocked");
    html = (await r.text()).slice(0, 2_000_000);
  } catch (e) { if (e instanceof ApiFail) throw e; throw new ApiFail("fetch_blocked"); }

  const title = decode(meta(html, "og:title") || html.match(/<title>([^<]*)/i)?.[1] || "");
  const desc = decode(meta(html, "og:description") || meta(html, "description"));
  const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]).join("\n").slice(0, 4000);
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 8000);

  // Candidate product photos: og:image first, then gallery-looking images on the same page.
  const og = decode(meta(html, "og:image"));
  const found = [...html.matchAll(/(?:https?:)?\/\/[^"'\s()<>]+?\.(?:jpe?g|png|webp)(?:\?[^"'\s()<>]*)?/gi)].map((m) => decode(m[0]));
  const ogDir = og ? og.replace(/[^/]+$/, "") : "";
  const pick = [og, ...found.filter((u) => ogDir && u.includes(ogDir.replace(/^https?:/, ""))), ...found.filter((u) => /goods|product|prd|item|detail/i.test(u))]
    .filter(Boolean).map((u) => (u.startsWith("//") ? "https:" + u : u))
    .filter((u, i, a) => a.indexOf(u) === i && !/logo|icon|banner|sprite|badge/i.test(u)).slice(0, 6);
  const imgs = (await Promise.all(pick.map((u) => fetchImage(u, page.href)))).filter((x): x is { type: string; data: string } => !!x);

  const content: Anthropic.Beta.BetaContentBlockParam[] = [];
  imgs.forEach((im, i) => {
    content.push({ type: "text", text: `이미지 ${i}` });
    content.push({ type: "image", source: { type: "base64", media_type: im.type as "image/jpeg", data: im.data } });
  });
  content.push({ type: "text", text: `쇼핑몰 상품 페이지 하나를 정리해 주세요.
${imgs.length ? `위 이미지 ${imgs.length}장은 이 페이지에서 찾은 사진이에요. product_image에는 사람 없이 이 상품만 찍힌 사진(흰 배경 등)의 번호를, 그런 사진이 없으면 이 상품이 가장 잘 보이는 사진의 번호를 적으세요. 상품과 관계없는 사진뿐이면 -1.` : "사진은 없으니 product_image는 -1."}
${ITEM_RULES}

제목: ${title}
설명: ${desc}
구조화 데이터: ${ld}
본문 텍스트: ${text}` });

  const out = await ask(content, {
    type: "object", additionalProperties: false, required: ["item", "product_image", "product_only"],
    properties: {
      item: { type: "object", additionalProperties: false, required: itemRequired, properties: itemProps },
      product_image: { type: "integer" },
      product_only: { type: "boolean" },
    },
  }, "medium");
  const im = imgs[out.product_image];
  return {
    item: out.item,
    image: im ? `data:${im.type};base64,${im.data}` : null,
    note: !imgs.length ? "페이지에서 상품 사진을 찾지 못했어요." : !im ? "상품 사진을 고르지 못했어요." : out.product_only ? "" : "옷만 찍힌 사진이 없어서 모델 컷을 넣었어요.",
  };
}

async function styleNote(outfit: string, weather: string) {
  const out = await ask([{ type: "text", text: `오늘 ${weather}. 아래 코디를 친구처럼 짧게 평가해 주세요. 어울리는 점 1가지와 더 좋아지는 팁 1가지, 한국어 두 문장, 이모지 없이.\n${outfit.slice(0, 2000)}` }],
    { type: "object", additionalProperties: false, required: ["text"], properties: { text: { type: "string" } } }, "low");
  return { text: out.text };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "bad_request" }, 405);
  try {
    const body = await req.json();
    switch (body?.action) {
      case "analyze_photo": return json(await analyzePhoto(String(body.image || ""), String(body.media_type || "image/jpeg")));
      case "read_link": return json(await readLink(String(body.url || "")));
      case "style_note": return json(await styleNote(String(body.outfit || ""), String(body.weather || "")));
      default: return json({ error: "bad_request" }, 400);
    }
  } catch (e) {
    const code = e instanceof ApiFail ? e.code : "upstream_error";
    if (!(e instanceof ApiFail)) console.error(e);
    // 200 with an error code so the page can show the right message.
    return json({ error: code });
  }
});
