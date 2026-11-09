/* Bundles src/main.ts into dist/Bouquet.user.js:
 * verbatim userscript header + one IIFE, unminified for readable Tampermonkey diffs.
 * The header's @version is the single source of truth: parsed here and injected as
 * __BOUQUET_VERSION__, from which src/constants.ts derives SCRIPT_TAG. */
const header = await Bun.file("src/userscript-header.txt").text();

const versionMatch = header.match(/^\/\/ @version\s+(\S+)\s*$/m);
const version = versionMatch?.[1] ?? "";
if (!/^\d+\.\d+\.\d+([-.+][0-9A-Za-z-.+]+)?$/.test(version)) {
  console.error("build: could not parse @version from src/userscript-header.txt");
  process.exit(1);
}

const result = await Bun.build({
  entrypoints: ["src/main.ts"],
  format: "iife",
  target: "browser",
  minify: false,
  sourcemap: "none",
  define: { __BOUQUET_VERSION__: JSON.stringify(version) },
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const code = await result.outputs[0].text();
await Bun.write("dist/Bouquet.user.js", `${header.trimEnd()}\n${code}`);

console.log(`built dist/Bouquet.user.js (${code.length} bytes)`);

export {};
