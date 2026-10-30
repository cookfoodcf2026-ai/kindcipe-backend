import assert from "node:assert/strict";
import test from "node:test";
import { FACEBOOK_USER_AGENTS, chooseFacebookContent, parseFacebookMeta, resolveFacebookCanonicalUrl, shouldRefetchFacebookCanonical } from "./recipes";

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

test("Facebook share links and short captions re-fetch canonical", () => {
  assert.equal(shouldRefetchFacebookCanonical("https://www.facebook.com/share/r/1RAPFYPDEj/", "short"), true);
  assert.equal(shouldRefetchFacebookCanonical("https://www.facebook.com/reel/123/", "x".repeat(399)), true);
  assert.equal(shouldRefetchFacebookCanonical("https://www.facebook.com/reel/123/", "x".repeat(400)), false);
});

test("Facebook canonical pick prefers Directions, then longer caption", () => {
  const base = { meta: { title: "", description: "", image: "", siteName: "", url: "" } };
  const short = { ...base, html: "", url: "https://www.facebook.com/reel/1/", caption: "Ingredients: potato" };
  const long = { ...base, html: "", url: "https://www.facebook.com/reel/2/", caption: "x".repeat(800) };
  const directions = { ...base, html: "", url: "https://www.facebook.com/reel/3/", caption: "Directions:\n" + "y".repeat(300) };
  assert.equal(chooseFacebookContent(short, long)?.url, long.url);
  assert.equal(chooseFacebookContent(long, directions)?.url, directions.url);
  assert.equal(chooseFacebookContent(directions, long)?.url, directions.url);
  assert.equal(chooseFacebookContent(short, null)?.url, short.url);
});
