import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const cli = (args: string[]) =>
  spawnSync(process.execPath, ["--import", "tsx", "src/cli.ts", ...args], {
    encoding: "utf8",
  });
test("CLI exit policies and JSON report", () => {
  const breaking = cli([
    "examples/baseline.json",
    "examples/breaking.json",
    "--format",
    "json",
  ]);
  assert.equal(breaking.status, 1);
  assert.equal(JSON.parse(breaking.stdout).summary.breaking, 4);
  assert.equal(
    cli(["examples/baseline.json", "examples/additive.json"]).status,
    0,
  );
  assert.equal(
    cli(["examples/baseline.json", "examples/review.json"]).status,
    1,
  );
  assert.equal(
    cli([
      "examples/baseline.json",
      "examples/review.json",
      "--fail-on",
      "breaking",
    ]).status,
    0,
  );
  assert.equal(
    cli([
      "examples/baseline.json",
      "examples/breaking.json",
      "--fail-on",
      "none",
    ]).status,
    0,
  );
});
test("CLI reports invalid inputs and usage as exit 2", () => {
  assert.equal(cli(["missing.json", "examples/baseline.json"]).status, 2);
  assert.equal(cli(["--format", "bogus"]).status, 2);
  assert.equal(cli(["--help"]).status, 0);
});
test("CLI exports HTML and refuses to overwrite existing files", () => {
  const dir = mkdtempSync(join(tmpdir(), "contract-watch-"));
  try {
    const out = join(dir, "report.html");
    assert.equal(
      cli([
        "examples/baseline.json",
        "examples/breaking.json",
        "--format",
        "html",
        "--out",
        out,
      ]).status,
      1,
    );
    assert.ok(readFileSync(out, "utf8").includes("Scope and limitations"));
    writeFileSync(out, "keep");
    assert.equal(
      cli(["examples/baseline.json", "examples/additive.json", "--out", out])
        .status,
      2,
    );
    assert.equal(readFileSync(out, "utf8"), "keep");
    assert.equal(
      cli([
        "examples/baseline.json",
        "examples/additive.json",
        "--out",
        "examples/baseline.json",
      ]).status,
      2,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
