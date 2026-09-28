import test from "node:test";
import assert from "node:assert/strict";
import { codeModeCatalog, primaryPrompt } from "../../dist/prompt.js";

test("only Code Mode system section is injected into primary prompt", () => {
  const messages = [
    { role: "system", content: "Host identity\n# Code Mode\nTool catalog here\n# Other\nsecret host text" },
    { role: "user", content: "do work" },
  ];
  assert.equal(codeModeCatalog(messages), "# Code Mode\nTool catalog here");
  assert.equal(primaryPrompt(messages).text, "# Code Mode\nTool catalog here\n\ndo work");
});
