import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compare } from "../src/compare.js";
import { parseSpec } from "../src/parse.js";
import { htmlReport } from "../src/report.js";
const load = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`../examples/${name}.json`, import.meta.url), "utf8"),
  );
const doc = (schema: any, direction = "response"): any => ({
  openapi: "3.0.3",
  info: { title: "Test", version: "1" },
  paths: {
    "/items": {
      post: {
        ...(direction === "request"
          ? { requestBody: { content: { "application/json": { schema } } } }
          : {}),
        responses: {
          "200": {
            description: "OK",
            ...(direction === "response"
              ? { content: { "application/json": { schema } } }
              : {}),
          },
        },
      },
    },
  },
});
const changes = (a: any, b: any, direction = "response") =>
  compare(doc(a, direction), doc(b, direction)).findings;
const breaking = (a: any, b: any, direction = "response") =>
  changes(a, b, direction).filter((f) => f.severity === "breaking");
test("seeded regression reports exactly four breaking changes", () => {
  const r = compare(load("baseline"), load("breaking"));
  assert.equal(r.summary.breaking, 4);
  assert.equal(r.summary.review, 0);
  assert.deepEqual(
    new Set(r.findings.map((f) => f.rule)),
    new Set(["enum", "required", "operation-removed"]),
  );
});
test("additive release preserves old response contract", () => {
  const r = compare(load("baseline"), load("additive"));
  assert.equal(r.summary.breaking, 0);
  assert.equal(r.summary.review, 0);
  assert.equal(r.summary.info, 2);
});
test("unchanged supported contract yields no findings", () =>
  assert.deepEqual(compare(load("baseline"), load("baseline")).findings, []));
test("unsupported composition explicitly requires review", () =>
  assert.ok(compare(load("baseline"), load("review")).summary.review > 0));
test("request enum narrowing breaks; widening does not", () => {
  assert.equal(
    breaking({ enum: ["a", "b"] }, { enum: ["a"] }, "request").length,
    1,
  );
  assert.equal(
    breaking({ enum: ["a"] }, { enum: ["a", "b"] }, "request").length,
    0,
  );
});
test("response enum widening breaks; narrowing does not", () => {
  assert.equal(breaking({ enum: ["a"] }, { enum: ["a", "b"] }).length, 1);
  assert.equal(breaking({ enum: ["a", "b"] }, { enum: ["a"] }).length, 0);
});
test("removing response enum restriction breaks", () =>
  assert.equal(breaking({ enum: ["a"] }, {}).length, 1));
test("integer is subset of number in both directions", () => {
  assert.equal(
    breaking({ type: "integer" }, { type: "number" }, "request").length,
    0,
  );
  assert.equal(breaking({ type: "integer" }, { type: "number" }).length, 1);
  assert.equal(breaking({ type: "number" }, { type: "integer" }).length, 0);
});
test("nullable widening and narrowing respect direction", () => {
  assert.equal(
    breaking({ type: "string" }, { type: "string", nullable: true }).length,
    1,
  );
  assert.equal(
    breaking({ type: "string", nullable: true }, { type: "string" }, "request")
      .length,
    1,
  );
});
test("required fields differ for input and output", () => {
  const a = { type: "object", properties: { id: { type: "string" } } },
    b = { ...a, required: ["id"] };
  assert.equal(breaking(a, b, "request").length, 1);
  assert.equal(breaking(b, a).length, 1);
  assert.equal(breaking(a, b).length, 0);
});
test("bounds tighten requests and relax responses", () => {
  assert.equal(
    breaking(
      { type: "string", maxLength: 20 },
      { type: "string", maxLength: 10 },
      "request",
    ).length,
    1,
  );
  assert.equal(
    breaking(
      { type: "string", maxLength: 10 },
      { type: "string", maxLength: 20 },
    ).length,
    1,
  );
});
test("optional response removal is review, not guaranteed break", () => {
  const r = changes(
    { type: "object", properties: { id: { type: "string" } } },
    { type: "object" },
  );
  assert.equal(r.filter((f) => f.severity === "breaking").length, 0);
  assert.ok(
    r.some((f) => f.rule === "property-removed" && f.severity === "review"),
  );
});
test("new response property violates old additionalProperties false", () =>
  assert.ok(
    breaking(
      { type: "object", additionalProperties: false },
      {
        type: "object",
        additionalProperties: false,
        properties: { x: { type: "string" } },
      },
    ).some((f) => f.rule === "property-added"),
  ));
test("path parameters are inherited and operation parameters override", () => {
  const a = load("baseline"),
    b = structuredClone(a);
  a.paths["/parcels/{id}"].delete.parameters = [
    {
      name: "id",
      in: "path",
      required: true,
      schema: { type: "string", maxLength: 20 },
    },
  ];
  b.paths["/parcels/{id}"].delete.parameters = [
    {
      name: "id",
      in: "path",
      required: true,
      schema: { type: "string", maxLength: 10 },
    },
  ];
  const r = compare(a, b);
  assert.equal(r.summary.breaking, 1);
});
test("new required parameter is breaking", () => {
  const a = load("baseline"),
    b = structuredClone(a);
  b.paths["/parcels"].get.parameters.push({
    in: "header",
    name: "Tenant",
    required: true,
    schema: { type: "string" },
  });
  assert.equal(compare(a, b).summary.breaking, 1);
});
test("request body becoming required is breaking", () => {
  const a = doc({}, "request"),
    b = structuredClone(a);
  b.paths["/items"].post.requestBody.required = true;
  assert.equal(compare(a, b).summary.breaking, 1);
});
test("removed media and response status are flagged", () => {
  const a = doc({ type: "string" }),
    b = structuredClone(a);
  delete b.paths["/items"].post.responses["200"].content;
  assert.ok(compare(a, b).findings.some((f) => f.rule === "media-removed"));
  b.paths["/items"].post.responses = { "204": { description: "Empty" } };
  assert.ok(compare(a, b).findings.some((f) => f.rule === "response-removed"));
});
test("security changes require review", () => {
  const a = load("baseline"),
    b = structuredClone(a);
  b.security = [{ bearer: [] }];
  assert.ok(compare(a, b).findings.some((f) => f.rule === "security"));
});
test("broken and external references are never silently accepted", () => {
  for (const ref of [
    "#/components/missing",
    "https://example.invalid/schema",
  ]) {
    const a = doc({ $ref: ref });
    assert.ok(compare(a, a).summary.review > 0);
  }
});
test("recursive local schema terminates with review", () => {
  const a = doc({ $ref: "#/components/schemas/Tree" });
  a.components = {
    schemas: {
      Tree: {
        type: "object",
        properties: { child: { $ref: "#/components/schemas/Tree" } },
      },
    },
  };
  assert.ok(compare(a, a).findings.some((f) => f.rule === "schema-depth"));
});
test("escaped JSON Pointer references resolve", () => {
  const a = doc({ $ref: "#/components/schemas/a~1b~0c" });
  a.components = { schemas: { "a/b~c": { type: "string" } } };
  const b = structuredClone(a);
  b.components.schemas["a/b~c"] = { type: "integer" };
  assert.equal(compare(a, b).summary.breaking, 1);
});
test("dangerous property names resolve as own keys only", () => {
  const a = doc({ $ref: "#/components/schemas/__proto__" });
  a.components = { schemas: {} };
  assert.ok(compare(a, a).summary.review > 0);
});
test("malformed basic documents and parameters are rejected", () => {
  assert.throws(() => compare({}, {}), /OpenAPI/);
  const a = load("baseline");
  a.paths["/parcels"].get.parameters = {};
  assert.throws(() => compare(a, a), /parameters/);
});
test("duplicate YAML keys and cycles rejected", () => {
  assert.throws(() => parseSpec("openapi: 3.0.3\nopenapi: 3.1.0"), /unique/);
  assert.throws(
    () =>
      parseSpec(
        'openapi: 3.0.3\ninfo: {title: A, version: "1"}\npaths: &loop {next: *loop}',
      ),
    /cyclic/,
  );
});
test("YAML and JSON normalize to same comparison", () => {
  const y = 'openapi: 3.0.3\ninfo: {title: Test, version: "1"}\npaths: {}';
  assert.deepEqual(
    compare(parseSpec(y), parseSpec(JSON.stringify(parseSpec(y)))).findings,
    [],
  );
});
test("input size limit is enforced", () =>
  assert.throws(() => parseSpec("x".repeat(2 * 1024 * 1024 + 1)), /2 MiB/));
test("HTML reports escape attacker-controlled names and values", () => {
  const a = load("baseline"),
    b = load("breaking");
  a.info.title = "</title><script>alert(1)</script>";
  const html = htmlReport(compare(a, b));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("default-src 'none'"));
});
test("results are deterministic", () =>
  assert.deepEqual(
    compare(load("baseline"), load("breaking")),
    compare(load("baseline"), load("breaking")),
  ));
test("new response properties respect the previous additional-property schema", () => {
  assert.ok(
    breaking(
      { type: "object", additionalProperties: { type: "string" } },
      {
        type: "object",
        additionalProperties: { type: "string" },
        properties: { count: { type: "number" } },
      },
    ).some((f) => f.rule === "type"),
  );
});
test("candidate-only references in added properties resolve against candidate", () => {
  const a = doc({ type: "object" }),
    b = doc({
      type: "object",
      properties: { value: { $ref: "#/components/schemas/New" } },
    });
  b.components = {
    schemas: {
      New: {
        type: "object",
        properties: { nested: { $ref: "#/components/schemas/Value" } },
      },
      Value: { type: "string" },
    },
  };
  assert.equal(compare(a, b).summary.review, 0);
});
test("invalid type and additionalProperties shapes need review", () => {
  for (const schema of [{ type: "unknown" }, { additionalProperties: 42 }])
    assert.ok(changes(schema, schema).some((f) => f.severity === "review"));
});
