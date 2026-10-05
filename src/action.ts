import {
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdtempSync,
  statSync,
} from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { compare } from "./compare.js";
import { MAX_BYTES, parseSpec } from "./parse.js";
import { htmlReport } from "./report.js";
try {
  const policy = process.env.CW_FAIL_ON ?? "review";
  if (!["review", "breaking", "none"].includes(policy))
    throw new Error("fail-on must be review, breaking, or none.");
  const workspace = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const read = (path: string | undefined, label: string) => {
    if (!path) throw new Error(`${label} input is required.`);
    const full = resolve(workspace, path),
      info = statSync(full);
    if (!info.isFile() || info.size > MAX_BYTES)
      throw new Error(`${label} must be a regular file no larger than 2 MiB.`);
    return parseSpec(readFileSync(full, "utf8"), label);
  };
  const report = compare(
    read(process.env.CW_BASELINE, "Baseline"),
    read(process.env.CW_CANDIDATE, "Candidate"),
  );
  const dir = mkdtempSync(
    join(process.env.RUNNER_TEMP ?? tmpdir(), "contract-watch-"),
  );
  writeFileSync(join(dir, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(dir, "report.html"), htmlReport(report));
  const exit =
    policy === "none"
      ? 0
      : report.summary.breaking > 0 ||
          (policy === "review" && report.summary.review > 0)
        ? 1
        : 0;
  if (process.env.GITHUB_OUTPUT)
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `report-directory=${dir}\nexit-code=${exit}\n`,
    );
  const summary = `## API Contract Watch\n\n${report.summary.breaking} breaking, ${report.summary.review} manual review, ${report.summary.info} informational.\n\nPolicy: ${policy}. ${exit ? "Review required before release." : "No policy violations detected."}\n\nDownload the report artifact for details. This is a bounded contract review, not a compatibility guarantee.\n`;
  if (process.env.GITHUB_STEP_SUMMARY)
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary);
  console.log(
    `${report.summary.breaking} breaking · ${report.summary.review} review · ${report.summary.info} informational`,
  );
  process.exitCode = exit;
} catch (e) {
  console.error(
    `Contract Watch: ${e instanceof Error ? e.message : String(e)}`,
  );
  process.exitCode = 2;
}
