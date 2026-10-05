import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import process from "node:process";

const root = resolve(new URL("..", import.meta.url).pathname);

async function walk(path) {
  const result = [];
  for (const name of await readdir(path)) {
    if (["node_modules", ".git"].includes(name)) continue;
    const full = join(path, name);
    const info = await stat(full);
    if (info.isDirectory()) result.push(...await walk(full));
    else result.push(full);
  }
  return result;
}

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exitCode = 1;
}

const files = await walk(root);
const relative = file => file.slice(root.length + 1).replaceAll("\\", "/");
const byRelative = new Set(files.map(relative));

for (const file of files.filter(file => extname(file) === ".json")) {
  try {
    JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    fail(`${relative(file)} contains invalid JSON: ${error.message}`);
  }
}

for (const file of files.filter(file => extname(file) === ".js" || extname(file) === ".mjs")) {
  const checked = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  if (checked.status !== 0) fail(`${relative(file)} failed syntax check:\n${checked.stderr || checked.stdout}`);
}

const importPattern = /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["'](\.[^"']+)["']/g;
for (const file of files.filter(file => extname(file) === ".js" || extname(file) === ".mjs")) {
  const source = await readFile(file, "utf8");
  for (const match of source.matchAll(importPattern)) {
    const target = normalize(resolve(dirname(file), match[1]));
    const candidates = [target, `${target}.js`, join(target, "index.js")];
    if (!candidates.some(existsSync)) fail(`${relative(file)} imports missing path ${match[1]}`);
  }
}

const moduleData = JSON.parse(await readFile(join(root, "module.json"), "utf8"));
for (const path of [...(moduleData.esmodules ?? []), ...(moduleData.styles ?? []), ...(moduleData.languages ?? []).map(item => item.path)]) {
  if (!byRelative.has(path)) fail(`module.json references missing file ${path}`);
}

const ru = JSON.parse(await readFile(join(root, "lang/ru.json"), "utf8"));
const en = JSON.parse(await readFile(join(root, "lang/en.json"), "utf8"));
const ruKeys = Object.keys(ru).sort();
const enKeys = Object.keys(en).sort();
if (JSON.stringify(ruKeys) !== JSON.stringify(enKeys)) fail("lang/ru.json and lang/en.json have different key sets");

if (!process.exitCode) {
  console.log(`Module check passed: ${files.length} files, ${files.filter(file => extname(file) === ".js").length} JavaScript files.`);
}
