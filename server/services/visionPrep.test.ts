import assert from "node:assert/strict";
import test from "node:test";
import { prepareVisionImages } from "../routers/aiRecipe";

const imageMessage = (url: string) => ([{
  role: "user",
  content: [
    { type: "text" as const, text: "請辨認圖片中嘅食材" },
    { type: "image_url" as const, image_url: { url } },
  ],
}]);

const imageResponse = () => new Response(new Uint8Array([1, 2, 3, 4]), {
  status: 200,
  headers: { "content-type": "image/jpeg" },
});

test("own screenshot key becomes signed URL", async () => {
  const logs: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { logs.push(args.map(String).join(" ")); };
  try {
    const out = await prepareVisionImages(imageMessage("/r2-storage/recipe-screenshots/f13/egg.jpg"), {
      familyId: 13,
      traceId: "req_signed",
      deps: { sign: async () => "https://r2.example/signed-image" },
    });
    assert.equal(out.trace.mode, "url");
    assert.equal(out.trace.resolved, 1);
    assert.equal((out.messages[0].content as any)[1].image_url.url, "https://r2.example/signed-image");
    assert.ok(logs.some((line) => line.includes("request=req_signed") && line.includes("mode=url") && line.includes("hasImage=1")));
    assert.ok(!logs.some((line) => line.includes("r2.example") || line.includes("egg.jpg")));
  } finally {
    console.log = originalLog;
  }
});

test("signing failure falls back to base64 data URL", async () => {
  const out = await prepareVisionImages(imageMessage("/r2-storage/recipe-screenshots/f13/egg.jpg"), {
    familyId: 13,
    traceId: "req_base64",
    deps: {
      sign: async () => { throw new Error("sign_failed"); },
      fetchImpl: async () => imageResponse(),
    },
  });
  assert.equal(out.trace.mode, "base64");
  assert.equal(out.trace.fallback, 1);
  assert.ok(String((out.messages[0].content as any)[1].image_url.url).startsWith("data:image/jpeg;base64,"));
  assert.ok(out.trace.bytes > 0);
});

test("signing timeout logs and still falls back", async () => {
  const out = await prepareVisionImages(imageMessage("/r2-storage/recipe-screenshots/f13/egg.jpg"), {
    familyId: 13,
    traceId: "req_timeout",
    deps: {
      sign: () => new Promise<string>(() => {}),
      fetchImpl: async () => imageResponse(),
      timeoutMs: 10,
    },
  });
  assert.equal(out.trace.mode, "base64");
  assert.equal(out.trace.timeout, 1);
});

test("foreign or path-traversal key is rejected", async () => {
  let called = 0;
  const out = await prepareVisionImages(imageMessage("/r2-storage/recipe-screenshots/f13/../f99/egg.jpg"), {
    familyId: 13,
    traceId: "req_reject",
    deps: { sign: async () => { called += 1; return "https://r2.example/nope"; } },
  });
  assert.equal(called, 0);
  assert.equal(out.trace.rejected, 1);
  assert.equal(out.trace.mode, "none");
});

test("external image URL is not signed or fetched", async () => {
  const out = await prepareVisionImages([
    { role: "user", content: [
      { type: "image_url", image_url: { url: "/r2-storage/recipe-screenshots/f13/a.jpg" } },
      { type: "image_url", image_url: { url: "https://external.example/b.jpg" } },
    ] },
  ], {
    familyId: 13,
    traceId: "req_mixed",
    deps: {
      sign: async () => "https://r2.example/a",
      fetchImpl: async () => imageResponse(),
    },
  });
  assert.equal(out.trace.images, 2);
  assert.equal(out.trace.rejected, 0);
  assert.equal(out.trace.mode, "url");
  assert.equal((out.messages[0].content as any)[1].image_url.url, "https://external.example/b.jpg");
});
