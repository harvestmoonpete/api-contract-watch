import { parseDocument } from "yaml";
import { validateDocument } from "./compare.js";
export const MAX_BYTES = 2 * 1024 * 1024;
export function parseSpec(
  text: string,
  label = "Document",
): Record<string, any> {
  if (new TextEncoder().encode(text).length > MAX_BYTES)
    throw new Error(`${label}: limit is 2 MiB per specification.`);
  const parsed = parseDocument(text, { uniqueKeys: true });
  if (parsed.errors.length)
    throw new Error(`${label}: ${parsed.errors[0].message}`);
  const value = parsed.toJS({ maxAliasCount: 25 });
  let count = 0;
  const ancestors = new Set<object>();
  const walk = (v: any, depth: number) => {
    if (++count > 60000 || depth > 80)
      throw new Error(
        `${label}: document is too complex (60,000 nodes / 80 levels maximum).`,
      );
    if (v !== null && typeof v === "object") {
      if (ancestors.has(v))
        throw new Error(`${label}: cyclic YAML aliases are not supported.`);
      ancestors.add(v);
      for (const item of Object.values(v)) walk(item, depth + 1);
      ancestors.delete(v);
    }
  };
  walk(value, 0);
  validateDocument(value, label);
  return value;
}
