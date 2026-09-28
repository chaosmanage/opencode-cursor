import { Agent, Cursor } from "@cursor/sdk";

const status = await Cursor.auth.status();
console.log("auth:", status.status);

if (status.status !== "logged-in") {
  console.log("SKIP: Cursor SDK is not logged in on this machine.");
  process.exitCode = 2;
} else {
  const models = await Cursor.models.list();
  console.log("models:", models.length);
  if (!models.length) {
    throw new Error("Cursor SDK returned no account-visible models.");
  }

  const preferred = models[0].variants?.find((variant) => variant.isDefault);
  const model = preferred
    ? { id: models[0].id, params: preferred.params }
    : { id: models[0].id };

  console.log("smoke model:", model.id);

  const agent = await Agent.create({
    model,
    tools: [],
    local: {
      cwd: process.cwd(),
      settingSources: [],
    },
  });

  try {
    const run = await agent.send(
      "Reply with exactly SDK_SMOKE_OK and nothing else.",
      { model, mode: "agent" },
    );
    const result = await run.wait();
    console.log("run status:", result.status);
    console.log("result:", result.result);
    console.log("usage:", result.usage ?? null);
    if (result.status !== "finished") {
      throw new Error(result.error?.message || "Cursor SDK smoke run failed.");
    }
  } finally {
    agent.close();
  }
}
