export type Severity = "breaking" | "review" | "info";
export interface Finding {
  id: string;
  severity: Severity;
  rule: string;
  operation: string;
  pointer: string;
  message: string;
  before?: string;
  after?: string;
}
export interface Report {
  version: 1;
  baseline: string;
  candidate: string;
  operations: number;
  findings: Finding[];
  summary: Record<Severity, number>;
  limitations: string[];
}
type Obj = Record<string, any>;
const methods = [
  "get",
  "put",
  "post",
  "delete",
  "options",
  "head",
  "patch",
  "trace",
];
export const limitations = [
  "Compares documented contracts, not running servers or business behavior. This is not a full OpenAPI validator or a proof of compatibility.",
  "Local JSON Pointer references only. External, unresolved, cyclic, and ambiguous reference forms require review; nothing is fetched.",
  "Composition, polymorphism, readOnly/writeOnly, security changes, and unsupported schema keywords require manual review.",
  "Paths are matched literally. A path-template rename is reported as a removed and added operation. No generated-client or SDK compatibility guarantee.",
];
const object = (v: unknown): v is Obj =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const own = (v: Obj, k: string) => Object.prototype.hasOwnProperty.call(v, k);
export const pointerPart = (v: string) =>
  v.replaceAll("~", "~0").replaceAll("/", "~1");
const canonical = (v: any): string =>
  JSON.stringify(
    v === undefined
      ? null
      : Array.isArray(v)
        ? v.map((x) => JSON.parse(canonical(x)))
        : object(v)
          ? Object.fromEntries(
              Object.keys(v)
                .sort()
                .map((k) => [k, JSON.parse(canonical(v[k]))]),
            )
          : v,
  );
const display = (v: any): string => canonical(v).slice(0, 600);
export function validateDocument(
  value: unknown,
  label = "Document",
): asserts value is Obj {
  if (
    !object(value) ||
    typeof value.openapi !== "string" ||
    !/^3\.[01]\.\d+$/.test(value.openapi)
  )
    throw new Error(`${label}: expected an OpenAPI 3.0.x or 3.1.x object.`);
  if (
    !object(value.info) ||
    typeof value.info.title !== "string" ||
    typeof value.info.version !== "string"
  )
    throw new Error(`${label}: info.title and info.version must be strings.`);
  if (!object(value.paths))
    throw new Error(`${label}: paths must be an object.`);
}
export function compare(baseline: unknown, candidate: unknown): Report {
  validateDocument(baseline, "Baseline");
  validateDocument(candidate, "Candidate");
  const findings: Finding[] = [];
  const seen = new Set<string>();
  let visits = 0;
  const emit = (
    severity: Severity,
    rule: string,
    operation: string,
    pointer: string,
    message: string,
    before?: any,
    after?: any,
  ) => {
    const key = `${severity}|${rule}|${operation}|${pointer}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      id: `CW-${String(findings.length + 1).padStart(4, "0")}`,
      severity,
      rule,
      operation,
      pointer,
      message,
      ...(before === undefined ? {} : { before: display(before) }),
      ...(after === undefined ? {} : { after: display(after) }),
    });
  };
  const review = (
    rule: string,
    op: string,
    at: string,
    message: string,
    a?: any,
    b?: any,
  ) => emit("review", rule, op, at, message, a, b);
  const resolve = (
    value: any,
    doc: Obj,
    op: string,
    at: string,
  ): Obj | undefined => {
    const refs = new Set<string>();
    while (object(value) && own(value, "$ref")) {
      const ref = value.$ref;
      if (typeof ref !== "string" || !ref.startsWith("#/") || refs.has(ref)) {
        review(
          "reference",
          op,
          at,
          "External, invalid, or cyclic reference needs manual review.",
          ref,
        );
        return;
      }
      if (
        Object.keys(value).some(
          (k) => !["$ref", "description", "summary"].includes(k),
        )
      ) {
        review(
          "reference-siblings",
          op,
          at,
          "Reference siblings are not evaluated.",
        );
        return;
      }
      refs.add(ref);
      let target: any = doc;
      try {
        for (const part of decodeURIComponent(ref.slice(2))
          .split("/")
          .map((p) => p.replaceAll("~1", "/").replaceAll("~0", "~"))) {
          if (!object(target) || !own(target, part)) throw new Error();
          target = target[part];
        }
      } catch {
        review(
          "reference",
          op,
          at,
          "Unresolved local reference needs manual review.",
          ref,
        );
        return;
      }
      value = target;
    }
    if (!object(value)) {
      review(
        "unsupported-shape",
        op,
        at,
        "Expected an object; this shape cannot be evaluated.",
        value,
      );
      return;
    }
    return value;
  };
  const checkUnknown = (
    value: Obj,
    allowed: string[],
    op: string,
    at: string,
  ) => {
    for (const k of Object.keys(value).sort())
      if (!allowed.includes(k) && !k.startsWith("x-"))
        review(
          "unsupported-field",
          op,
          `${at}/${pointerPart(k)}`,
          `The ${k} field is outside the supported comparison rules.`,
        );
  };
  const schemaKeys = [
    "type",
    "nullable",
    "enum",
    "required",
    "properties",
    "items",
    "additionalProperties",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "minProperties",
    "maxProperties",
    "title",
    "description",
    "example",
    "examples",
    "deprecated",
    "default",
    "$comment",
  ];
  const types = (s: Obj): Set<string> | undefined => {
    if (s.type === undefined) return;
    if (
      !(
        typeof s.type === "string" ||
        (Array.isArray(s.type) &&
          s.type.every((t: any) => typeof t === "string"))
      )
    )
      return;
    const out = new Set<string>(Array.isArray(s.type) ? s.type : [s.type]);
    if (out.has("number")) out.add("integer");
    if (s.nullable === true) out.add("null");
    return out;
  };
  const subset = (a: Set<string> | undefined, b: Set<string> | undefined) =>
    b === undefined || (a !== undefined && [...a].every((t) => b.has(t)));
  const schema = (
    a0: any,
    b0: any,
    direction: "request" | "response",
    op: string,
    at: string,
    depth = 0,
    aDoc: Obj = baseline,
    bDoc: Obj = candidate,
  ) => {
    if (++visits > 10000)
      throw new Error(
        "Comparison exceeds 10,000 schema visits. Split the specification into smaller documents.",
      );
    if (depth > 30) {
      review(
        "schema-depth",
        op,
        at,
        "Recursive or deeply nested schema requires manual review.",
      );
      return;
    }
    const a = resolve(a0 ?? {}, aDoc, op, at),
      b = resolve(b0 ?? {}, bDoc, op, at);
    if (!a || !b) return;
    checkUnknown(a, schemaKeys, op, at);
    checkUnknown(b, schemaKeys, op, at);
    // Do not derive confident findings from constructs whose semantics we do not model.
    if (
      [...Object.keys(a), ...Object.keys(b)].some(
        (k) => !schemaKeys.includes(k) && !k.startsWith("x-"),
      )
    )
      return;
    for (const s of [a, b]) {
      if (
        s.type !== undefined &&
        !(
          typeof s.type === "string" ||
          (Array.isArray(s.type) &&
            s.type.every((v: any) => typeof v === "string"))
        )
      ) {
        review(
          "schema-shape",
          op,
          at,
          "Schema type must be a string or string array.",
        );
        return;
      }
      if (
        s.type !== undefined &&
        (Array.isArray(s.type) ? s.type : [s.type]).some(
          (t: string) =>
            ![
              "null",
              "boolean",
              "object",
              "array",
              "number",
              "string",
              "integer",
            ].includes(t),
        )
      ) {
        review("schema-shape", op, at, "Unknown schema type requires review.");
        return;
      }
      if (
        s.additionalProperties !== undefined &&
        typeof s.additionalProperties !== "boolean" &&
        !object(s.additionalProperties)
      ) {
        review(
          "schema-shape",
          op,
          at,
          "additionalProperties must be a boolean or schema object.",
        );
        return;
      }
      if (
        s.required !== undefined &&
        !(
          Array.isArray(s.required) &&
          s.required.every((v: any) => typeof v === "string")
        )
      ) {
        review(
          "schema-shape",
          op,
          at,
          "Schema required must be a string array.",
        );
        return;
      }
      if (s.enum !== undefined && !Array.isArray(s.enum)) {
        review("schema-shape", op, at, "Schema enum must be an array.");
        return;
      }
      if (s.properties !== undefined && !object(s.properties)) {
        review("schema-shape", op, at, "Schema properties must be an object.");
        return;
      }
    }
    const input = direction === "request";
    if (!(input ? subset(types(a), types(b)) : subset(types(b), types(a))))
      emit(
        "breaking",
        "type",
        op,
        at,
        input
          ? "Accepted request types were narrowed."
          : "Possible response types exceed the previous contract.",
        a.type,
        b.type,
      );
    const ea = Array.isArray(a.enum)
        ? new Set<string>(a.enum.map(canonical))
        : undefined,
      eb = Array.isArray(b.enum)
        ? new Set<string>(b.enum.map(canonical))
        : undefined;
    if (!(input ? subset(ea, eb) : subset(eb, ea)))
      emit(
        "breaking",
        "enum",
        op,
        `${at}/enum`,
        input
          ? "Previously accepted enum values may now be rejected."
          : "Responses may contain enum values old clients do not expect.",
        a.enum,
        b.enum,
      );
    for (const [key, lower] of [
      ["minimum", true],
      ["maximum", false],
      ["minLength", true],
      ["maxLength", false],
      ["minItems", true],
      ["maxItems", false],
      ["minProperties", true],
      ["maxProperties", false],
    ] as const) {
      if (
        [a[key], b[key]].some((v) => v !== undefined && typeof v !== "number")
      ) {
        review(
          "constraint-shape",
          op,
          `${at}/${key}`,
          "Expected a numeric bound.",
        );
        continue;
      }
      const fallback = lower ? -Infinity : Infinity,
        av = a[key] ?? fallback,
        bv = b[key] ?? fallback;
      const tighter = lower ? bv > av : bv < av,
        looser = lower ? bv < av : bv > av;
      if (input ? tighter : looser)
        emit(
          "breaking",
          "bound",
          op,
          `${at}/${key}`,
          input
            ? "A request constraint became stricter."
            : "A response guarantee was relaxed.",
          a[key],
          b[key],
        );
    }
    const ar = new Set<string>(a.required ?? []),
      br = new Set<string>(b.required ?? []);
    for (const key of [...(input ? br : ar)].sort())
      if (!(input ? ar : br).has(key))
        emit(
          "breaking",
          "required",
          op,
          `${at}/required/${pointerPart(key)}`,
          input
            ? `Request field ${key} is newly required.`
            : `Response field ${key} is no longer guaranteed.`,
          ar.has(key),
          br.has(key),
        );
    const ap: Obj = a.properties ?? {},
      bp: Obj = b.properties ?? {};
    for (const key of [
      ...new Set([...Object.keys(ap), ...Object.keys(bp)]),
    ].sort()) {
      const p = `${at}/properties/${pointerPart(key)}`;
      if (own(ap, key) && own(bp, key))
        schema(ap[key], bp[key], direction, op, p, depth + 1, aDoc, bDoc);
      else if (own(ap, key)) {
        if (input) {
          if (b.additionalProperties === false)
            emit(
              "breaking",
              "property-removed",
              op,
              p,
              `Previously declared request field ${key} is now forbidden.`,
            );
          else
            review(
              "property-removed",
              op,
              p,
              `Request field ${key} is no longer documented; confirm it is still handled.`,
            );
        } else
          emit(
            ar.has(key) ? "breaking" : "review",
            "property-removed",
            op,
            p,
            `Response field ${key} was removed.`,
          );
      } else {
        if (!input && a.additionalProperties === false)
          emit(
            "breaking",
            "property-added",
            op,
            p,
            `New response field ${key} violates the old closed-object contract.`,
          );
        else
          emit(
            "info",
            "property-added",
            op,
            p,
            `Field ${key} was added${input && br.has(key) ? " (see required-field finding)" : ""}.`,
          );
        // Missing properties inherit additionalProperties, not an unconstrained declared field.
        const prior = object(a.additionalProperties)
          ? a.additionalProperties
          : {};
        if (input && a.additionalProperties !== false)
          schema(prior, bp[key], direction, op, p, depth + 1, aDoc, bDoc);
        else if (!input && object(a.additionalProperties))
          schema(prior, bp[key], direction, op, p, depth + 1, aDoc, bDoc);
        else schema(bp[key], bp[key], direction, op, p, depth + 1, bDoc, bDoc);
      }
    }
    if (
      input &&
      a.additionalProperties !== false &&
      b.additionalProperties === false
    )
      emit(
        "breaking",
        "additional-properties",
        op,
        `${at}/additionalProperties`,
        "The request object no longer accepts additional fields.",
      );
    if (
      !input &&
      a.additionalProperties === false &&
      b.additionalProperties !== false
    )
      emit(
        "breaking",
        "additional-properties",
        op,
        `${at}/additionalProperties`,
        "Responses may now contain fields forbidden by the old contract.",
      );
    if (object(a.additionalProperties) || object(b.additionalProperties))
      schema(
        object(a.additionalProperties) ? a.additionalProperties : {},
        object(b.additionalProperties) ? b.additionalProperties : {},
        direction,
        op,
        `${at}/additionalProperties`,
        depth + 1,
        aDoc,
        bDoc,
      );
    if (a.items !== undefined || b.items !== undefined)
      schema(
        a.items ?? {},
        b.items ?? {},
        direction,
        op,
        `${at}/items`,
        depth + 1,
        aDoc,
        bDoc,
      );
  };
  const media = (
    a: Obj,
    b: Obj,
    direction: "request" | "response",
    op: string,
    at: string,
  ) => {
    for (const key of [
      ...new Set([...Object.keys(a), ...Object.keys(b)]),
    ].sort()) {
      const p = `${at}/${pointerPart(key)}`;
      if (!own(b, key)) {
        emit(
          "breaking",
          "media-removed",
          op,
          p,
          `Media type ${key} was removed from the ${direction}.`,
        );
        continue;
      }
      if (!own(a, key)) {
        emit(
          direction === "response" ? "review" : "info",
          "media-added",
          op,
          p,
          `Media type ${key} was added to the ${direction}.`,
        );
      }
      const av = resolve(a[key] ?? {}, baseline, op, p),
        bv = resolve(b[key], candidate, op, p);
      if (!av || !bv) continue;
      checkUnknown(av, ["schema", "example", "examples"], op, p);
      checkUnknown(bv, ["schema", "example", "examples"], op, p);
      if (own(a, key))
        schema(av.schema ?? {}, bv.schema ?? {}, direction, op, `${p}/schema`);
      else {
        // Check coverage without declaring the entire new media type a narrowing change.
        const orig =
          direction === "request" ? (av.schema ?? {}) : (bv.schema ?? {});
        if (direction === "request")
          checkUnknown(bv.schema ?? {}, schemaKeys, op, `${p}/schema`);
        else
          schema(
            orig,
            bv.schema ?? {},
            direction,
            op,
            `${p}/schema`,
            0,
            candidate,
            candidate,
          );
      }
    }
  };
  const operations = (
    doc: Obj,
  ): Map<string, { item: Obj; value: Obj; at: string }> => {
    const out = new Map<string, { item: Obj; value: Obj; at: string }>();
    for (const path of Object.keys(doc.paths).sort()) {
      if (path.startsWith("x-")) continue;
      if (!path.startsWith("/"))
        throw new Error("Path keys must begin with /.");
      const item = resolve(
        doc.paths[path],
        doc,
        "DOCUMENT",
        `/paths/${pointerPart(path)}`,
      );
      if (!item) continue;
      checkUnknown(
        item,
        [...methods, "summary", "description", "parameters", "servers"],
        "DOCUMENT",
        `/paths/${pointerPart(path)}`,
      );
      for (const method of methods)
        if (own(item, method)) {
          const op = `${method.toUpperCase()} ${path}`,
            at = `/paths/${pointerPart(path)}/${method}`;
          const value = resolve(item[method], doc, op, at);
          if (value) out.set(op, { item, value, at });
        }
    }
    return out;
  };
  const ao = operations(baseline),
    bo = operations(candidate);
  checkUnknown(
    baseline,
    [
      "openapi",
      "info",
      "paths",
      "components",
      "servers",
      "security",
      "tags",
      "externalDocs",
    ],
    "DOCUMENT",
    "",
  );
  checkUnknown(
    candidate,
    [
      "openapi",
      "info",
      "paths",
      "components",
      "servers",
      "security",
      "tags",
      "externalDocs",
    ],
    "DOCUMENT",
    "",
  );
  if (canonical(baseline.servers) !== canonical(candidate.servers))
    review(
      "servers",
      "DOCUMENT",
      "/servers",
      "Server URLs or variables changed.",
      baseline.servers,
      candidate.servers,
    );
  if (baseline.openapi !== candidate.openapi)
    review(
      "dialect",
      "DOCUMENT",
      "/openapi",
      "OpenAPI version changed; confirm schema-dialect and tooling compatibility.",
      baseline.openapi,
      candidate.openapi,
    );
  for (const op of [...new Set([...ao.keys(), ...bo.keys()])].sort()) {
    const old = ao.get(op),
      next = bo.get(op);
    if (!next) {
      emit(
        "breaking",
        "operation-removed",
        op,
        old!.at,
        "An existing operation was removed.",
      );
      continue;
    }
    if (!old) {
      emit(
        "info",
        "operation-added",
        op,
        next.at,
        "A new operation was added.",
      );
      continue;
    }
    const a = old.value,
      b = next.value,
      at = next.at;
    const allowed = [
      "tags",
      "summary",
      "description",
      "operationId",
      "externalDocs",
      "parameters",
      "requestBody",
      "responses",
      "deprecated",
      "security",
      "servers",
    ];
    checkUnknown(a, allowed, op, at);
    checkUnknown(b, allowed, op, at);
    if (
      !object(a.responses) ||
      !object(b.responses) ||
      !Object.keys(a.responses).length ||
      !Object.keys(b.responses).length
    )
      throw new Error(`${op}: responses must be a non-empty object.`);
    const sa = a.security ?? baseline.security ?? [],
      sb = b.security ?? candidate.security ?? [];
    if (
      canonical(sa) !== canonical(sb) ||
      canonical(baseline.components?.securitySchemes) !==
        canonical(candidate.components?.securitySchemes)
    )
      review(
        "security",
        op,
        `${at}/security`,
        "Authentication requirements or security scheme definitions changed. Verify client access.",
        sa,
        sb,
      );
    if (
      canonical(a.servers ?? old.item.servers) !==
      canonical(b.servers ?? next.item.servers)
    )
      review(
        "servers",
        op,
        `${at}/servers`,
        "Operation or path server configuration changed.",
      );
    if (a.operationId !== b.operationId)
      review(
        "operation-id",
        op,
        `${at}/operationId`,
        "Operation ID changed; generated SDK method names may change.",
        a.operationId,
        b.operationId,
      );
    const parameters = (item: Obj, value: Obj, doc: Obj) => {
      const result = new Map<string, Obj>();
      for (const list of [item.parameters ?? [], value.parameters ?? []]) {
        if (!Array.isArray(list))
          throw new Error(`${op}: parameters must be an array.`);
        const local = new Set<string>();
        for (const raw of list) {
          const p = resolve(raw, doc, op, `${at}/parameters`);
          if (!p) continue;
          if (
            typeof p.name !== "string" ||
            !["path", "query", "header", "cookie"].includes(p.in)
          )
            throw new Error(
              `${op}: each parameter needs name and a valid in location.`,
            );
          const key = `${p.in}:${p.in === "header" ? p.name.toLowerCase() : p.name}`;
          if (local.has(key))
            throw new Error(`${op}: duplicate parameter ${key}.`);
          local.add(key);
          result.set(key, p);
        }
      }
      return result;
    };
    const pa = parameters(old.item, a, baseline),
      pb = parameters(next.item, b, candidate);
    for (const key of [...new Set([...pa.keys(), ...pb.keys()])].sort()) {
      const x = pa.get(key),
        y = pb.get(key),
        p = `${at}/parameters/${pointerPart(key)}`;
      if (!y) {
        review(
          "parameter-removed",
          op,
          p,
          `Parameter ${key} was removed; confirm old clients can still send it.`,
        );
        continue;
      }
      if (!x) {
        emit(
          y.required ? "breaking" : "info",
          "parameter-added",
          op,
          p,
          `${y.required ? "Required" : "Optional"} parameter ${key} was added.`,
        );
        continue;
      }
      checkUnknown(
        x,
        [
          "name",
          "in",
          "description",
          "required",
          "deprecated",
          "schema",
          "example",
          "examples",
          "style",
          "explode",
          "allowReserved",
          "allowEmptyValue",
        ],
        op,
        p,
      );
      checkUnknown(
        y,
        [
          "name",
          "in",
          "description",
          "required",
          "deprecated",
          "schema",
          "example",
          "examples",
          "style",
          "explode",
          "allowReserved",
          "allowEmptyValue",
        ],
        op,
        p,
      );
      if (!x.required && y.required)
        emit(
          "breaking",
          "parameter-required",
          op,
          p,
          `Parameter ${key} is newly required.`,
        );
      for (const k of ["style", "explode", "allowReserved", "allowEmptyValue"])
        if (canonical(x[k]) !== canonical(y[k]))
          review(
            "parameter-serialization",
            op,
            `${p}/${k}`,
            `Parameter ${k} changed.`,
            x[k],
            y[k],
          );
      schema(x.schema ?? {}, y.schema ?? {}, "request", op, `${p}/schema`);
    }
    if (a.requestBody !== undefined || b.requestBody !== undefined) {
      if (b.requestBody === undefined)
        review(
          "body-removed",
          op,
          `${at}/requestBody`,
          "Request body was removed; confirm old clients can still send it.",
        );
      else {
        const x = resolve(
            a.requestBody ?? {},
            baseline,
            op,
            `${at}/requestBody`,
          ),
          y = resolve(b.requestBody, candidate, op, `${at}/requestBody`);
        if (x && y) {
          checkUnknown(
            x,
            ["description", "required", "content"],
            op,
            `${at}/requestBody`,
          );
          checkUnknown(
            y,
            ["description", "required", "content"],
            op,
            `${at}/requestBody`,
          );
          if (!x.required && y.required)
            emit(
              "breaking",
              "body-required",
              op,
              `${at}/requestBody`,
              "A request body is newly required.",
            );
          if (!object(y.content))
            throw new Error(`${op}: requestBody.content must be an object.`);
          media(
            x.content ?? {},
            y.content,
            "request",
            op,
            `${at}/requestBody/content`,
          );
        }
      }
    }
    for (const code of [
      ...new Set([...Object.keys(a.responses), ...Object.keys(b.responses)]),
    ].sort()) {
      if (code.startsWith("x-")) continue;
      const p = `${at}/responses/${pointerPart(code)}`;
      if (!own(b.responses, code)) {
        emit(
          "breaking",
          "response-removed",
          op,
          p,
          `Documented response ${code} was removed.`,
        );
        continue;
      }
      if (!own(a.responses, code)) {
        review(
          "response-added",
          op,
          p,
          `New response ${code} may require handling in existing clients.`,
        );
        continue;
      }
      const x = resolve(a.responses[code], baseline, op, p),
        y = resolve(b.responses[code], candidate, op, p);
      if (!x || !y) continue;
      checkUnknown(x, ["description", "content", "headers", "links"], op, p);
      checkUnknown(y, ["description", "content", "headers", "links"], op, p);
      if (canonical(x.headers) !== canonical(y.headers))
        review(
          "response-headers",
          op,
          `${p}/headers`,
          "Response headers changed; header compatibility is not evaluated.",
        );
      if (canonical(x.links) !== canonical(y.links))
        review("response-links", op, `${p}/links`, "Response links changed.");
      if (
        (x.content !== undefined && !object(x.content)) ||
        (y.content !== undefined && !object(y.content))
      )
        throw new Error(`${op}: response content must be an object.`);
      media(x.content ?? {}, y.content ?? {}, "response", op, `${p}/content`);
    }
  }
  return {
    version: 1,
    baseline: `${baseline.info.title} ${baseline.info.version}`,
    candidate: `${candidate.info.title} ${candidate.info.version}`,
    operations: ao.size,
    findings,
    summary: {
      breaking: findings.filter((f) => f.severity === "breaking").length,
      review: findings.filter((f) => f.severity === "review").length,
      info: findings.filter((f) => f.severity === "info").length,
    },
    limitations,
  };
}
