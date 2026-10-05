# API Contract Watch

Review an API change before shipping it. Compare two local OpenAPI JSON or YAML documents, see compatibility risks, and export a report for a pull request.

**[Open the live workbench](https://harvestmoonpete.github.io/api-contract-watch/)** · [Daniel Oliveros Guerra](https://harvestmoonpete.github.io/)

This portfolio project demonstrates a shared TypeScript analysis engine, a Node.js CLI, a reusable GitHub Action, and an accessible browser workbench. It is a bounded contract reviewer, not a full OpenAPI validator or proof of compatibility.

## Two-minute walkthrough

1. Open the workbench. The breaking release reports four changes: a removed operation, narrower request enum, broader response enum, and a lost required response field.
2. Select **Additive release** to see two informational additions.
3. Select **Needs review** to see how unsupported composition is explicitly flagged.
4. Edit either document or load your own files, then compare. Download JSON for automation or a standalone HTML report for review.

The browser runs the actual engine in a Web Worker. Files remain in the browser; there is no upload endpoint, AI, account, or simulated analysis. GitHub serves the application assets. Inputs are held in memory and disappear on reload.

## Run locally

Requires Node.js 22 or newer (CI uses 24).

```sh
npm ci
npm run build
node dist/cli.js examples/baseline.json examples/breaking.json
npm run dev
```

The development UI opens at `http://127.0.0.1:5190/`. This is a static application and CLI; no database or Docker services are required. Dependencies are pinned and the lockfile is committed. The package is source-distributed, not published to npm.

## CLI

```sh
node dist/cli.js old.yaml new.yaml --format json
node dist/cli.js old.yaml new.yaml --format html --out review.html
node dist/cli.js old.yaml new.yaml --fail-on breaking
node dist/cli.js old.yaml new.yaml --fail-on none
```

Formats: `text` (default), `json`, `html`. The default `--fail-on review` fails on both breaking and manual-review findings. `breaking` fails only on breaking findings; `none` emits the report without blocking on findings. Invalid input still fails under every policy.

Exit codes: **0** policy passed, **1** policy failed, **2** input, usage, or output error. Output files must not already exist; the CLI refuses to overwrite inputs or reports. Paths are local files, not URLs. Create the parent output directory first.

## GitHub Action

Check out your repository with both specification files available. This composite action installs its pinned dependencies and compiles the CLI on the runner; npm access is required. Pin the action to a reviewed commit SHA for reproducible production use.

```yaml
permissions:
  contents: read
steps:
  - uses: actions/checkout@v4
  - uses: harvestmoonpete/api-contract-watch@main
    id: contract
    with:
      baseline: api/baseline.yaml
      candidate: api/openapi.yaml
      fail-on: review
  - uses: actions/upload-artifact@v4
    if: always() && steps.contract.outputs.report-directory != ''
    with:
      name: contract-report
      path: ${{ steps.contract.outputs.report-directory }}
```

Outputs are `report-directory` (JSON and HTML files) and `exit-code` (0 or 1). Parse/input failures exit 2 without a report. The job summary contains counts and the chosen policy. The action does not fetch a baseline, post comments, or modify either specification. Use normal pull-request workflows with read-only permissions when comparing contributions.

## Rules and tradeoffs

The engine accepts OpenAPI 3.0.x and 3.1.x documents with basic structural checks. Semantics follow the [OpenAPI specification](https://spec.openapis.org/oas/v3.1.0.html) for a deliberately small subset. Validate documents with a complete OpenAPI validator separately.

- Operations are matched by literal path and HTTP method. Removal is breaking; additions are informational.
- Path-level parameters are inherited, and operation-level parameters override matching name/location pairs. New required parameters and bodies are breaking.
- Request types and enums must continue accepting previous values. Response types and enums must stay within previous guarantees. For example, adding an enum value is usually compatible for input but risky for output.
- Required properties, numeric/length/collection bounds, nested properties, array items, and `additionalProperties` are compared directionally.
- Removed media types and response codes are flagged. New response codes/media types need review. Parameter serialization, server, operation ID, authentication, response-header and link changes need review.
- Local JSON Pointer references are resolved without fetching anything. Unresolved, external, cyclic and reference-sibling constructs need review.

Unsupported schema keywords—including composition, polymorphism, formats, patterns and read/write-only semantics—produce manual-review findings on visited schemas, and comparison stops at that unsupported subtree. Unsupported unchanged constructs may therefore still require review. This intentionally favors visibility over a reassuring empty report.

Only reachable portions of **existing matched operations** are deeply compared. Newly added operations are summarized; unused components are not audited. Finding `pointer` values describe logical locations and are not guaranteed to be executable JSON Pointers (parameter keys and required-field names are normalized for readability). Finding IDs are deterministic within a report, not persistent identities across changed reports.

Other limitations: no server execution, generated SDK analysis, business-rule checks, dialect-wide validation, semantic path-renaming detection, full content negotiation, or proof that an undocumented client remains compatible. An empty result means only that the supported rules found no issues. Review ambiguous cases with API consumers.

## Architecture

- `src/compare.ts`: pure, deterministic TypeScript engine with request/response directionality and bounded traversal.
- `src/parse.ts`: JSON/YAML loading, duplicate-key rejection, alias/cycle checks and input limits.
- `src/cli.ts` / `src/action.ts`: Node.js filesystem and CI adapters with explicit exit policies.
- `src/report.ts`: text and escaped standalone HTML rendering.
- `web/`: responsive browser interface and worker using the same engine. No second implementation of the rules.

Limits: 2 MiB per input, 60,000 parsed nodes, parse depth 80, schema depth 30 and 10,000 schema visits. The browser terminates analysis after 10 seconds. These limits keep a small utility responsive; split larger contracts. HTML reports escape untrusted content and disable scripts and external resources with a Content Security Policy.

## Validation and delivery

```sh
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:browser
```

Unit/CLI tests cover directional compatibility, references, malformed inputs, YAML aliases, deterministic results, safe report rendering and exit policies. Browser tests cover desktop/mobile samples, stale-result invalidation, actionable errors, report download, overflow and automated WCAG checks. CI also runs the composite action against a known breaking fixture and verifies its failure and exported report. Automated accessibility checks complement keyboard and visual walkthroughs; they are not an accessibility certification.

GitHub Actions deploys the Pages workbench only after checks pass on `main`. Browser tests run under `/api-contract-watch/` to catch repository-subpath asset issues. The checked-in examples are synthetic.

## License

MIT. Created by Daniel Oliveros Guerra.
