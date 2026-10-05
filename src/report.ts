import type { Report } from "./compare.js";
export const escapeHtml = (v: string) =>
  v
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
export function textReport(r: Report): string {
  return [
    `API Contract Watch`,
    `${r.baseline} → ${r.candidate}`,
    `${r.summary.breaking} breaking · ${r.summary.review} review · ${r.summary.info} informational`,
    ...r.findings.map(
      (f) =>
        `\n[${f.severity.toUpperCase()}] ${f.operation}\n${f.message}\n${f.pointer}`,
    ),
    "\nNo findings is not a proof of compatibility.",
    ...r.limitations,
  ].join("\n");
}
export function htmlReport(r: Report): string {
  const e = escapeHtml;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>API Contract Watch report</title><style>body{font:16px/1.6 system-ui;background:#111820;color:#e8edf4;max-width:960px;margin:40px auto;padding:0 24px}h1{font-size:32px}article{background:#1c2631;border:1px solid #536273;border-radius:8px;padding:20px;margin:18px 0}small,code{color:#bed2e5}code{overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere}summary{cursor:pointer}a{color:#a4d8fc}</style><h1>API Contract Watch</h1><p>${e(r.baseline)} → ${e(r.candidate)}</p><p>${r.summary.breaking} breaking · ${r.summary.review} review · ${r.summary.info} informational</p>${r.findings.map((f) => `<article><small>${e(f.id)} / ${e(f.severity.toUpperCase())} / ${e(f.rule)}</small><h2>${e(f.operation)}</h2><p>${e(f.message)}</p><code>${e(f.pointer)}</code>${f.before !== undefined || f.after !== undefined ? `<details><summary>Before and after</summary><pre>Before: ${e(f.before ?? "(not specified)")}\nAfter: ${e(f.after ?? "(not specified)")}</pre></details>` : ""}</article>`).join("")}${!r.findings.length ? "<p>No changes were flagged by the supported rules.</p>" : ""}<h2>Scope and limitations</h2><ul>${r.limitations.map((x) => `<li>${e(x)}</li>`).join("")}</ul></html>`;
}
