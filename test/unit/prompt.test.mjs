import test from "node:test";
import assert from "node:assert/strict";
import { codeModeCatalog, primaryPrompt } from "../../dist/prompt.js";

test("only Code Mode system section is injected into primary prompt", () => {
  const messages = [
    { role: "system", content: "Host identity\n# Code Mode\nTool catalog here\n# Other\nsecret host text" },
    { role: "user", content: "do work" },
  ];
  assert.equal(codeModeCatalog(messages), "# Code Mode\nTool catalog here");
  const prompt = primaryPrompt(messages).text;
  assert.match(prompt, /# OpenCode Tool Routing/);
  assert.match(prompt, /use read\/edit\/bash directly/);
  assert.match(prompt, /# Code Mode\nTool catalog here/);
  assert.doesNotMatch(prompt, /secret host text/);
  assert.match(prompt, /do work$/);
});

import { recoveryPrompt, hasPriorConversation } from "../../dist/prompt.js";

test("recovery prompt reconstructs prior OpenCode transcript", () => {
  const messages = [
    { role: "system", content: "# Code Mode\ncatalog" },
    { role: "user", content: "first" },
    { role: "assistant", content: "done" },
    { role: "user", content: "continue" },
  ];
  assert.equal(hasPriorConversation(messages), true);
  const prompt = recoveryPrompt(messages).text;
  assert.match(prompt, /USER:\nfirst/);
  assert.match(prompt, /ASSISTANT:\ndone/);
  assert.match(prompt, /USER:\ncontinue/);
});
