#!/usr/bin/env node
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { compare } from "./compare.js";
import { MAX_BYTES, parseSpec } from "./parse.js";
import { htmlReport, textReport } from "./report.js";
const usage = `Usage: contract-watch BASELINE CANDIDATE [--format text|json|html] [--out FILE] [--fail-on review|breaking|none]\n\nLocal JSON/YAML OpenAPI 3.0/3.1 files, up to 2 MiB each. No network calls.\nDefault: text output, fail on breaking OR review findings.\nExit codes: 0 policy passed, 1 policy failed, 2 input/usage/output error.\nUse --format html --out report.html for a standalone report.`;
async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ["--help", "-h"].includes(args[0])) {
    console.log(usage);
    return;
  }
  const files: string[] = [],
    opts: Record<string, string> = { format: "text", "fail-on": "review" };
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) {
      const key = args[i].slice(2);
      if (
        !["format", "out", "fail-on"].includes(key) ||
        !args[i + 1] ||
        args[i + 1].startsWith("--")
      )
        throw new Error(usage);
      opts[key] = args[++i];
    } else files.push(args[i]);
  }
  if (
    files.length !== 2 ||
    !["text", "json", "html"].includes(opts.format) ||
    !["review", "breaking", "none"].includes(opts["fail-on"])
  )
    throw new Error(usage);
  if (opts.out && files.some((f) => resolve(f) === resolve(opts.out)))
    throw new Error("Output must not overwrite either input specification.");
  const specs = await Promise.all(
    files.map(async (f, i) => {
      const meta = await stat(f);
      if (!meta.isFile() || meta.size > MAX_BYTES)
        throw new Error(`${f}: expected a regular file no larger than 2 MiB.`);
      return parseSpec(
        await readFile(f, "utf8"),
        i === 0 ? "Baseline" : "Candidate",
      );
    }),
  );
  const report = compare(specs[0], specs[1]);
  const output =
    opts.format === "json"
      ? JSON.stringify(report, null, 2)
      : opts.format === "html"
        ? htmlReport(report)
        : textReport(report);
  if (opts.out) await writeFile(opts.out, output + "\n", { flag: "wx" });
  else process.stdout.write(output + "\n");
  process.exitCode =
    opts["fail-on"] === "none"
      ? 0
      : report.summary.breaking > 0 ||
          (opts["fail-on"] === "review" && report.summary.review > 0)
        ? 1
        : 0;
}
main().catch((e) => {
  process.stderr.write(
    `Contract Watch: ${e instanceof Error ? e.message : String(e)}\n`,
  );
  process.exitCode = 2;
});
