import test from "node:test";
import assert from "node:assert/strict";
import { imagesFromContent, customToolContent } from "../../dist/media.js";

test("data URL image becomes SDK image", () => {
  const images = imagesFromContent([{ type: "image_url", image_url: "data:image/png;base64,aGVsbG8=" }]);
  assert.deepEqual(images, [{ mimeType: "image/png", data: "aGVsbG8=" }]);
});

test("tool image content remains inline", () => {
  const content = customToolContent([{ type: "image", data: "aGVsbG8=", mime_type: "image/png" }]);
  assert.deepEqual(content, [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }]);
});
