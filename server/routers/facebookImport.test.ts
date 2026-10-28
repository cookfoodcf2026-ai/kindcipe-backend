import assert from "node:assert/strict";
import test from "node:test";
import { FACEBOOK_USER_AGENTS, parseFacebookMeta, resolveFacebookCanonicalUrl } from "./recipes";

test("Facebook UA order keeps browser UAs before crawler fallback", () => {
  assert.deepEqual(FACEBOOK_USER_AGENTS.map((u) => u.label), ["iphone", "chrome", "facebookexternalhit"]);
});

test("Facebook canonical URL keeps only Facebook http(s) URLs", () => {
  assert.equal(
    resolveFacebookCanonicalUrl(
      "https://www.facebook.com/reel/1412147200842544/",
      "https://www.facebook.com/share/r/1Hu9ZyuV1H/",
    ),
    "https://www.facebook.com/reel/1412147200842544/",
  );
  assert.equal(resolveFacebookCanonicalUrl("fb://fullscreen_video/1", "https://www.facebook.com/share/r/x/"), "");
  assert.equal(resolveFacebookCanonicalUrl("https://example.com/reel/1", "https://www.facebook.com/"), "");
});

test("Facebook meta parser reads description/title/image/url", () => {
  const html = `
    <meta property="og:title" content="Loaded Hot Honey Beef Sweet Potato" />
    <meta property="og:description" content="Ingredients: sweet potato" />
    <meta content="https://cdn.example/image.jpg" property="og:image" />
    <meta property="og:url" content="https://www.facebook.com/reel/1412147200842544/" />
  `;
  const meta = parseFacebookMeta(html);
  assert.equal(meta.title, "Loaded Hot Honey Beef Sweet Potato");
  assert.equal(meta.description, "Ingredients: sweet potato");
  assert.equal(meta.image, "https://cdn.example/image.jpg");
  assert.equal(meta.url, "https://www.facebook.com/reel/1412147200842544/");
});

test("Facebook empty HTML has no content", () => {
  assert.deepEqual(parseFacebookMeta("<html></html>"), {
    title: "", description: "", image: "", siteName: "", url: "",
  });
});
