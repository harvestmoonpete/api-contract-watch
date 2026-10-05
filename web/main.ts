import baseline from "../examples/baseline.json" with { type: "json" };
import breaking from "../examples/breaking.json" with { type: "json" };
import additive from "../examples/additive.json" with { type: "json" };
import review from "../examples/review.json" with { type: "json" };
import type { Report } from "../src/compare.js";
import { htmlReport } from "../src/report.js";
import "./style.css";
const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const before = $<HTMLTextAreaElement>("baseline"),
  after = $<HTMLTextAreaElement>("candidate");
const samples = { breaking, additive, review };
const inputVersions: Record<string, number> = { baseline: 0, candidate: 0 };
let result: Report | undefined,
  worker: Worker | undefined,
  timer: ReturnType<typeof setTimeout> | undefined;
const status = $("status"),
  error = $("error"),
  compareButton = $<HTMLButtonElement>("compare");
function invalidate() {
  worker?.terminate();
  worker = undefined;
  clearTimeout(timer);
  result = undefined;
  compareButton.disabled = false;
  error.hidden = true;
  status.textContent = "Inputs changed — compare again";
  $("findings").replaceChildren();
  for (const type of ["breaking", "review", "info"])
    $(type + "-count").textContent = "—";
  for (const type of ["json", "html"])
    $<HTMLButtonElement>("download-" + type).disabled = true;
}
function render() {
  const host = $("findings");
  host.replaceChildren();
  if (!result) return;
  const filter = $<HTMLSelectElement>("filter").value;
  const findings = result.findings.filter(
    (f) => filter === "all" || f.severity === filter,
  );
  if (!findings.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = result.findings.length
      ? "No findings in this category."
      : "No changes flagged by the supported rules. This does not prove compatibility.";
    host.append(p);
  }
  for (const finding of findings) {
    const card = document.createElement("article");
    card.className = "finding " + finding.severity;
    const top = document.createElement("div");
    top.className = "finding-top";
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent =
      finding.severity === "review"
        ? "MANUAL REVIEW"
        : finding.severity.toUpperCase();
    const id = document.createElement("span");
    id.textContent = finding.id + " / " + finding.rule;
    top.append(badge, id);
    const title = document.createElement("h3");
    title.textContent = finding.operation;
    const explanation = document.createElement("p");
    explanation.textContent = finding.message;
    const path = document.createElement("code");
    path.textContent = finding.pointer;
    card.append(top, title, explanation, path);
    if (finding.before !== undefined || finding.after !== undefined) {
      const details = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = "Before and after";
      const values = document.createElement("pre");
      values.textContent = `Before: ${finding.before ?? "(not specified)"}\nAfter: ${finding.after ?? "(not specified)"}`;
      details.append(summary, values);
      card.append(details);
    }
    host.append(card);
  }
}
function fail(message: string) {
  worker?.terminate();
  worker = undefined;
  clearTimeout(timer);
  compareButton.disabled = false;
  status.textContent = "Comparison could not finish";
  error.textContent = message;
  error.hidden = false;
}
function run() {
  invalidate();
  status.textContent = "Comparing contracts…";
  compareButton.disabled = true;
  worker = new Worker(new URL("./worker.ts", import.meta.url), {
    type: "module",
  });
  worker.onmessage = ({
    data,
  }: {
    data: { report?: Report; error?: string };
  }) => {
    if (data.error) {
      fail(data.error);
      return;
    }
    result = data.report;
    worker?.terminate();
    worker = undefined;
    clearTimeout(timer);
    compareButton.disabled = false;
    if (!result) {
      fail("No report returned. Try a smaller specification.");
      return;
    }
    for (const type of ["breaking", "review", "info"] as const)
      $(type + "-count").textContent = String(result.summary[type]);
    for (const type of ["json", "html"])
      $<HTMLButtonElement>("download-" + type).disabled = false;
    status.textContent = `${result.operations} baseline operations · ${result.findings.length} finding${result.findings.length === 1 ? "" : "s"}`;
    render();
  };
  worker.onerror = () =>
    fail("Analysis failed. Reload the page or try a smaller specification.");
  timer = setTimeout(
    () =>
      fail(
        "Analysis exceeded 10 seconds. Split the specification into smaller files.",
      ),
    10000,
  );
  worker.postMessage({ baseline: before.value, candidate: after.value });
}
const load = (name: keyof typeof samples) => {
  inputVersions.baseline++;
  inputVersions.candidate++;
  before.value = JSON.stringify(baseline, null, 2);
  after.value = JSON.stringify(samples[name], null, 2);
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-sample]",
  ))
    button.setAttribute("aria-pressed", String(button.dataset.sample === name));
  run();
};
for (const button of document.querySelectorAll<HTMLButtonElement>(
  "[data-sample]",
))
  button.onclick = () => load(button.dataset.sample as keyof typeof samples);
for (const input of [before, after])
  input.addEventListener("input", () => {
    inputVersions[input.id]++;
    invalidate();
    for (const b of document.querySelectorAll("[data-sample]"))
      b.setAttribute("aria-pressed", "false");
  });
for (const id of ["baseline", "candidate"]) {
  $<HTMLInputElement>(id + "-file").addEventListener(
    "change",
    async (event) => {
      const input = event.target as HTMLInputElement,
        file = input.files?.[0];
      if (!file) return;
      const current = ++inputVersions[id];
      invalidate();
      if (file.size > 2 * 1024 * 1024) {
        fail("File exceeds the 2 MiB limit. Choose a smaller specification.");
        input.value = "";
        return;
      }
      try {
        const text = await file.text();
        if (current !== inputVersions[id]) return;
        $<HTMLTextAreaElement>(id).value = text;
        invalidate();
        status.textContent = "File loaded — compare when ready";
      } catch {
        if (current !== inputVersions[id]) return;
        fail("File could not be read. Try selecting it again.");
      }
      input.value = "";
    },
  );
}
compareButton.onclick = run;
$("filter").onchange = render;
for (const type of ["json", "html"])
  $("download-" + type).onclick = () => {
    if (!result) return;
    const url = URL.createObjectURL(
      new Blob(
        [
          type === "json"
            ? JSON.stringify(result, null, 2)
            : htmlReport(result),
        ],
        { type: type === "json" ? "application/json" : "text/html" },
      ),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `contract-report.${type}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
load("breaking");
