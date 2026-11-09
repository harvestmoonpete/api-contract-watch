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
let challengeStep: number | null = null;
let focusChallengeAfterCheck = false;
let challengeCandidate = structuredClone(breaking) as {
  paths: Record<string, any>;
  components: typeof breaking.components;
  [key: string]: any;
};
const repairs = [
  {
    title: "1 / Preserve accepted inputs and predictable outputs",
    why: "Old callers must still be able to send queued. Old clients only handle queued, shipped, and delivered in responses. Restore both enum contracts; accepting more input and emitting more output have opposite compatibility effects.",
    diff: "Request status:  [shipped, delivered] → [queued, shipped, delivered]\nResponse status: [queued, shipped, delivered, returned] → [queued, shipped, delivered]",
    button: "Repair enum contracts",
    remaining: 4,
  },
  {
    title: "2 / Keep the tracking URL guarantee",
    why: "Existing clients rely on trackingUrl being present. The field still exists in the schema, but removing it from required allows responses that omit it. Restore that guarantee.",
    diff: "Parcel.required: [id, status] → [id, status, trackingUrl]",
    button: "Restore required field",
    remaining: 2,
  },
  {
    title: "3 / Keep the existing endpoint available",
    why: "Clients still call DELETE /parcels/{id}. Restore its documented operation. A future removal needs a versioning or migration plan agreed with those consumers.",
    diff: "paths: restore /parcels/{id} with its path parameter and DELETE response",
    button: "Restore deleted endpoint",
    remaining: 1,
  },
];
function exitChallenge(
  message = "Challenge exited. Your current specifications remain in the editors.",
) {
  challengeStep = null;
  focusChallengeAfterCheck = false;
  $("challenge-work").hidden = false;
  $("challenge-progress").textContent = message;
  $("challenge-repair").hidden = true;
  $("challenge-exit").hidden = true;
  for (const id of [
    "challenge-step",
    "challenge-why",
    "challenge-diff",
    "challenge-outcome",
  ])
    $(id).textContent = "";
  $<HTMLProgressElement>("challenge-meter").value = 0;
}
function showChallenge() {
  if (challengeStep === null) return;
  const verified =
    !!result &&
    result.summary.breaking === (repairs[challengeStep]?.remaining ?? 0) &&
    result.summary.review === 0;
  const repair = $<HTMLButtonElement>("challenge-repair");
  repair.disabled = !verified;
  $("challenge-progress").textContent = verified
    ? `${challengeStep} of 3 repairs verified · ${result!.summary.breaking} breaking findings remain`
    : "Checking the changed contract…";
  $<HTMLProgressElement>("challenge-meter").value = verified
    ? challengeStep
    : Math.max(0, challengeStep - 1);
  const step = repairs[challengeStep];
  if (step) {
    $("challenge-step").textContent = step.title;
    $("challenge-why").textContent = step.why;
    $("challenge-diff").textContent = step.diff;
    repair.textContent = step.button;
    $("challenge-outcome").textContent =
      "Review the proposed change, apply it, and watch the analyzer verify the result.";
  } else if (verified) {
    repair.hidden = true;
    $("challenge-step").textContent =
      "Challenge complete: four compatibility risks repaired";
    $("challenge-why").textContent =
      "You preserved accepted requests, constrained response values, restored a required field, and kept an endpoint available. The candidate still declares version 2.0.0; these were targeted contract repairs, not a version-label change.";
    $("challenge-diff").textContent = "Breaking findings: 4 → 2 → 1 → 0";
    $("challenge-outcome").textContent =
      "Takeaway: preserve what callers may send and what clients can rely on receiving. Download the report below, then try your own specifications. Zero findings is not proof of runtime or SDK compatibility.";
  }
  if (verified && focusChallengeAfterCheck) {
    focusChallengeAfterCheck = false;
    const target = step ? repair : $("challenge-step");
    if (!step) target.tabIndex = -1;
    target.focus();
  }
}
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
  if (challengeStep !== null)
    $<HTMLButtonElement>("challenge-repair").disabled = true;
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
  if (challengeStep !== null)
    $("challenge-progress").textContent =
      "Verification failed. Retry Compare contracts or restart the challenge.";
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
    showChallenge();
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
  if (challengeStep !== null)
    exitChallenge(
      "Sample changed. Restart the challenge to begin a fresh exercise.",
    );
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
    if (challengeStep !== null)
      exitChallenge(
        "Manual editing paused the challenge. Compare your edits normally, or restart the sample exercise.",
      );
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
      if (challengeStep !== null)
        exitChallenge(
          "File loading ended the sample exercise. Your file can be compared normally.",
        );
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
$("swap").onclick = () => {
  if (challengeStep !== null)
    exitChallenge(
      "Swapping inputs ended the sample exercise. Compare the reverse direction normally.",
    );
  inputVersions.baseline++;
  inputVersions.candidate++;
  [before.value, after.value] = [after.value, before.value];
  for (const id of ["baseline-file", "candidate-file"])
    $<HTMLInputElement>(id).value = "";
  for (const button of document.querySelectorAll("[data-sample]"))
    button.setAttribute("aria-pressed", "false");
  invalidate();
  status.textContent =
    "Specifications swapped — compare to review the reverse direction";
};
$("challenge-start").onclick = () => {
  load("breaking");
  challengeCandidate = structuredClone(breaking);
  challengeStep = 0;
  focusChallengeAfterCheck = true;
  $("challenge-work").hidden = false;
  $("challenge-exit").hidden = false;
  $("challenge-repair").hidden = false;
  $("challenge-start").textContent = "Restart with sample specs";
  $<HTMLSelectElement>("filter").value = "all";
  showChallenge();
};
$("challenge-exit").onclick = () => exitChallenge();
$("challenge-repair").onclick = () => {
  if (
    challengeStep === null ||
    challengeStep >= repairs.length ||
    $<HTMLButtonElement>("challenge-repair").disabled
  )
    return;
  if (challengeStep === 0) {
    challengeCandidate.paths["/parcels"].get.parameters[0].schema.enum =
      structuredClone(baseline.paths["/parcels"].get.parameters[0].schema.enum);
    challengeCandidate.components.schemas.Parcel.properties.status.enum =
      structuredClone(
        baseline.components.schemas.Parcel.properties.status.enum,
      );
  } else if (challengeStep === 1) {
    challengeCandidate.components.schemas.Parcel.required = structuredClone(
      baseline.components.schemas.Parcel.required,
    );
  } else {
    challengeCandidate.paths["/parcels/{id}"] = structuredClone(
      baseline.paths["/parcels/{id}"],
    );
  }
  challengeStep++;
  focusChallengeAfterCheck = true;
  inputVersions.candidate++;
  after.value = JSON.stringify(challengeCandidate, null, 2);
  for (const button of document.querySelectorAll("[data-sample]"))
    button.setAttribute("aria-pressed", "false");
  run();
  showChallenge();
};
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
