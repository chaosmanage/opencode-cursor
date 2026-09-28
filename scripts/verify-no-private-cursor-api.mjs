import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const roots = ["src", "dist"];
const forbidden = [
  ["private backend hostname", /api2[.]cursor[.]sh/i],
  ["private AgentService", /agent[.]v1[.]AgentService/i],
  ["private AvailableModels RPC", /\bAvailableModels\b/],
  ["private GetUsableModels RPC", /\bGetUsableModels\b/],
  ["private NameAgent RPC", /\bNameAgent\b/],
  ["legacy h2 bridge", /h2-bridge/i],
  ["generated Cursor protobuf", /agent_pb[.]js|agent_pb[.]ts/i],
  ["plugin-owned PKCE", /\bcode_verifier\b|\bpkce\b/i],
];

async function walk(path) {
  const out = [];
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const full = join(path, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (/\.(?:ts|js|mjs|cjs)$/.test(entry.name)) out.push(full);
  }
  return out;
}

let failed = false;
for (const root of roots) {
  let files = [];
  try { files = await walk(root); } catch { continue; }
  for (const file of files) {
    const text = await readFile(file, "utf8");
    for (const [label, pattern] of forbidden) {
      if (pattern.test(text)) {
        console.error("Forbidden " + label + " reference in " + file);
        failed = true;
      }
    }
  }
}
if (failed) process.exit(1);
console.log("No private Cursor protocol references found in first-party runtime code.");
