import { compare } from "../src/compare.js";
import { parseSpec } from "../src/parse.js";
self.onmessage = (
  event: MessageEvent<{ baseline: string; candidate: string }>,
) => {
  try {
    self.postMessage({
      report: compare(
        parseSpec(event.data.baseline, "Baseline"),
        parseSpec(event.data.candidate, "Candidate"),
      ),
    });
  } catch (e) {
    self.postMessage({ error: e instanceof Error ? e.message : String(e) });
  }
};
