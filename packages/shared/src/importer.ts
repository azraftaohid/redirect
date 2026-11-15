import {
  importLinkItemSchema,
  slugSchema,
  statusCodeSchema,
  tagsSchema,
  targetUrlSchema,
  titleSchema,
  type ImportItemError,
  type ImportItemResult,
  type ImportLinkInput,
  type ImportLinksResponse,
} from "./schemas.js";
import { validateTargetUrl } from "./validation.js";

export type ImportTargetField =
  | "targetUrl"
  | "slug"
  | "title"
  | "statusCode"
  | "tags"
  | "isActive"
  | "forwardQuery"
  | "expiresAt"
  | "createdAt"
  | "updatedAt";

export type FieldMappingMode = "omit" | "field" | "constant";

export interface FieldMappingEntry {
  mode: FieldMappingMode;
  sourceField?: string;
  constantValue?: string;
}

export type ImportFieldMapping = Record<ImportTargetField, FieldMappingEntry>;

export type ImportFieldKind =
  | "url"
  | "slug"
  | "string"
  | "statusCode"
  | "tags"
  | "boolean"
  | "timestamp";

export interface ImportableFieldDescriptor {
  key: ImportTargetField;
  label: string;
  required: boolean;
  kind: ImportFieldKind;
  allowConstant: boolean;
  description: string;
}

export const IMPORTABLE_LINK_FIELDS: readonly ImportableFieldDescriptor[] = [
  {
    key: "targetUrl",
    label: "Destination URL",
    required: true,
    kind: "url",
    allowConstant: true,
    description: "Absolute http:// or https:// target URL.",
  },
  {
    key: "slug",
    label: "Slug",
    required: false,
    kind: "slug",
    allowConstant: false,
    description: "Short path segment. Leave blank or unmapped to auto-generate.",
  },
  {
    key: "title",
    label: "Title",
    required: false,
    kind: "string",
    allowConstant: true,
    description: "Optional display label (up to 200 characters).",
  },
  {
    key: "statusCode",
    label: "Status Code",
    required: false,
    kind: "statusCode",
    allowConstant: true,
    description: "HTTP redirect status: 301, 302, 307 (default), or 308.",
  },
  {
    key: "tags",
    label: "Tags",
    required: false,
    kind: "tags",
    allowConstant: true,
    description: "Array or comma/semicolon/pipe-separated tags (max 10).",
  },
  {
    key: "isActive",
    label: "Active",
    required: false,
    kind: "boolean",
    allowConstant: true,
    description: "Boolean flag (true/false, 1/0, yes/no). Defaults to true.",
  },
  {
    key: "forwardQuery",
    label: "Forward Query",
    required: false,
    kind: "boolean",
    allowConstant: true,
    description: "Forward incoming query params (true/false). Defaults to true.",
  },
  {
    key: "expiresAt",
    label: "Expires At",
    required: false,
    kind: "timestamp",
    allowConstant: true,
    description: "Date string (ISO/SQL) or epoch timestamp (s/ms).",
  },
  {
    key: "createdAt",
    label: "Created At",
    required: false,
    kind: "timestamp",
    allowConstant: true,
    description: "Creation date string or epoch timestamp (applied on insert).",
  },
  {
    key: "updatedAt",
    label: "Updated At",
    required: false,
    kind: "timestamp",
    allowConstant: true,
    description: "Last update date string or epoch timestamp (applied on insert).",
  },
] as const;

export type CsvDelimiter = "," | ";" | "\t";

const COMPACT_YYYYMMDD_REGEX =
  /^(19[7-9]\d|20\d\d|21\d\d)(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;
const NUMERIC_STRING_REGEX = /^-?\d+(\.\d+)?$/;
const SQL_NAIVE_DATETIME_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})[T\s]+(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?$/i;
const DATE_ONLY_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_WITH_TZ_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})[T\s]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i;
const SLASH_DATETIME_REGEX =
  /^(?:(\d{4})\/(\d{1,2})\/(\d{1,2})|(\d{1,2})\/(\d{1,2})\/(\d{4}))(?:\s+\d{1,2}:\d{2}(?::\d{2})?(?:\s*(?:GMT|UTC|[+-]\d{2}:?\d{2}))?)?$/i;
const MONTH_NAME_REGEX =
  /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i;
const FOUR_DIGIT_YEAR_REGEX = /\b(?:19\d\d|2\d{3})\b/;

function isValidYearRange(d: Date): boolean {
  const year = d.getUTCFullYear();
  return Number.isFinite(d.getTime()) && year >= 1900 && year <= 9999;
}

function buildValidatedUtcDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  ms = 0
): Date | null {
  const d = new Date(Date.UTC(year, month - 1, day, hour, minute, second, ms));
  if (
    !isValidYearRange(d) ||
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day ||
    d.getUTCHours() !== hour ||
    d.getUTCMinutes() !== minute ||
    d.getUTCSeconds() !== second
  ) {
    return null;
  }
  return d;
}

export function parseImportTimestamp(
  raw: unknown
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined) {
    return { ok: true, value: null };
  }

  if (typeof raw === "string" && raw.trim() === "") {
    return { ok: true, value: null };
  }

  if (raw instanceof Date) {
    if (!isValidYearRange(raw)) {
      return { ok: false, error: "Invalid Date object." };
    }
    return { ok: true, value: raw.toISOString() };
  }

  const trimmed = typeof raw === "string" ? raw.trim() : "";

  if (typeof raw === "number" || (typeof raw === "string" && NUMERIC_STRING_REGEX.test(trimmed))) {
    const compactCandidate =
      typeof raw === "string"
        ? trimmed
        : Number.isInteger(raw)
          ? String(raw)
          : "";
    if (COMPACT_YYYYMMDD_REGEX.test(compactCandidate)) {
      const year = Number(compactCandidate.slice(0, 4));
      const month = Number(compactCandidate.slice(4, 6));
      const day = Number(compactCandidate.slice(6, 8));
      const compactDate = buildValidatedUtcDate(year, month, day);
      if (!compactDate) {
        return { ok: false, error: `Invalid calendar date "${compactCandidate}".` };
      }
      return { ok: true, value: compactDate.toISOString() };
    }

    const num = typeof raw === "number" ? raw : Number(trimmed);
    if (!Number.isFinite(num)) {
      return { ok: false, error: `Invalid numeric timestamp "${String(raw).slice(0, 64)}".` };
    }

    const abs = Math.abs(num);
    let ms: number;
    if (abs < 1e11) {
      ms = Math.round(num * 1000);
    } else if (abs < 1e14) {
      ms = Math.round(num);
    } else if (abs < 1e17) {
      ms = Math.round(num / 1000);
    } else {
      ms = Math.round(num / 1e6);
    }

    const epochDate = new Date(ms);
    if (!isValidYearRange(epochDate)) {
      return { ok: false, error: `Epoch timestamp out of range "${String(raw).slice(0, 64)}".` };
    }
    return { ok: true, value: epochDate.toISOString() };
  }

  if (typeof raw !== "string") {
    return { ok: false, error: `Unsupported timestamp value (${typeof raw}).` };
  }

  const dateOnlyMatch = trimmed.match(DATE_ONLY_REGEX);
  if (dateOnlyMatch) {
    const d = buildValidatedUtcDate(
      Number(dateOnlyMatch[1]),
      Number(dateOnlyMatch[2]),
      Number(dateOnlyMatch[3])
    );
    if (!d) {
      return { ok: false, error: `Invalid calendar date "${trimmed.slice(0, 64)}".` };
    }
    return { ok: true, value: d.toISOString() };
  }

  const sqlMatch = trimmed.match(SQL_NAIVE_DATETIME_REGEX);
  if (sqlMatch) {
    const fracStr = sqlMatch[7] ?? "";
    const ms = fracStr ? Number(fracStr.slice(0, 3).padEnd(3, "0")) : 0;
    const d = buildValidatedUtcDate(
      Number(sqlMatch[1]),
      Number(sqlMatch[2]),
      Number(sqlMatch[3]),
      Number(sqlMatch[4]),
      Number(sqlMatch[5]),
      Number(sqlMatch[6] ?? "0"),
      ms
    );
    if (!d) {
      return { ok: false, error: `Invalid datetime "${trimmed.slice(0, 64)}".` };
    }
    return { ok: true, value: d.toISOString() };
  }

  const isoTzMatch = trimmed.match(ISO_WITH_TZ_REGEX);
  if (isoTzMatch) {
    const validCalendar = buildValidatedUtcDate(
      Number(isoTzMatch[1]),
      Number(isoTzMatch[2]),
      Number(isoTzMatch[3])
    );
    if (!validCalendar) {
      return { ok: false, error: `Invalid calendar date "${trimmed.slice(0, 64)}".` };
    }
    const parsed = new Date(trimmed);
    if (!isValidYearRange(parsed)) {
      return { ok: false, error: `Invalid timestamp "${trimmed.slice(0, 64)}".` };
    }
    return { ok: true, value: parsed.toISOString() };
  }

  const slashMatch = trimmed.match(SLASH_DATETIME_REGEX);
  if (slashMatch) {
    const year = Number(slashMatch[1] ?? slashMatch[6]);
    const month = Number(slashMatch[2] ?? slashMatch[4]);
    const day = Number(slashMatch[3] ?? slashMatch[5]);
    if (!buildValidatedUtcDate(year, month, day)) {
      return { ok: false, error: `Invalid calendar date "${trimmed.slice(0, 64)}".` };
    }
    const parsed = new Date(trimmed);
    if (!isValidYearRange(parsed)) {
      return { ok: false, error: `Invalid timestamp "${trimmed.slice(0, 64)}".` };
    }
    return { ok: true, value: parsed.toISOString() };
  }

  if (MONTH_NAME_REGEX.test(trimmed) && FOUR_DIGIT_YEAR_REGEX.test(trimmed)) {
    const parsed = new Date(trimmed);
    if (!isValidYearRange(parsed)) {
      return { ok: false, error: `Invalid timestamp "${trimmed.slice(0, 64)}".` };
    }
    return { ok: true, value: parsed.toISOString() };
  }

  return { ok: false, error: `Invalid timestamp "${trimmed.slice(0, 64)}".` };
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export function detectCsvDelimiter(rawText: string): CsvDelimiter {
  const clean = stripBom(rawText);
  const counts: Record<CsvDelimiter, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  let seenNonWhitespace = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;
    if (ch === '"') {
      if (inQuotes && clean[i + 1] === '"') {
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      seenNonWhitespace = true;
      continue;
    }

    if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (seenNonWhitespace) {
        break;
      }
      continue;
    }

    if (ch !== " " && ch !== "\t") {
      seenNonWhitespace = true;
    } else if (ch === "\t") {
      seenNonWhitespace = true;
    }

    if (!inQuotes && (ch === "," || ch === ";" || ch === "\t")) {
      counts[ch]++;
    }
  }

  let best: CsvDelimiter = ",";
  let bestCount = counts[","];
  for (const candidate of [";", "\t"] as const) {
    if (counts[candidate] > bestCount) {
      best = candidate;
      bestCount = counts[candidate];
    }
  }
  return bestCount > 0 ? best : ",";
}

export function parseCsvContent(
  rawText: string,
  options?: { delimiter?: CsvDelimiter; hasHeader?: boolean }
):
  | { ok: true; delimiter: CsvDelimiter; headers: string[]; rows: Record<string, string>[] }
  | { ok: false; error: string } {
  const clean = stripBom(rawText);
  if (clean.trim().length === 0) {
    return { ok: false, error: "CSV file is empty." };
  }

  const delimiter = options?.delimiter ?? detectCsvDelimiter(clean);
  const hasHeader = options?.hasHeader !== false;

  const matrix: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let cellStarted = false;

  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]!;

    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }

    if (ch === '"' && !cellStarted) {
      inQuotes = true;
      cellStarted = true;
      continue;
    }

    if (ch === delimiter) {
      row.push(cell);
      cell = "";
      cellStarted = false;
      continue;
    }

    if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && clean[i + 1] === "\n") {
        i++;
      }
      row.push(cell);
      matrix.push(row);
      row = [];
      cell = "";
      cellStarted = false;
      continue;
    }

    cell += ch;
    cellStarted = true;
  }

  if (inQuotes) {
    return { ok: false, error: "Invalid CSV: unclosed quoted field." };
  }

  if (cell.length > 0 || cellStarted || row.length > 0) {
    row.push(cell);
    matrix.push(row);
  }

  const nonBlankRows = matrix.filter((r) => r.some((c) => c.trim().length > 0));
  if (nonBlankRows.length === 0) {
    return { ok: false, error: "CSV file contains no data rows." };
  }

  const colCount = nonBlankRows.reduce((max, r) => Math.max(max, r.length), 0);
  const headers: string[] = [];
  let dataStartIndex = 0;

  if (hasHeader) {
    if (nonBlankRows.length < 2) {
      return { ok: false, error: "CSV file contains a header row but no data rows." };
    }
    const headerRow = nonBlankRows[0]!;
    const usedHeaders = new Set<string>();
    for (let c = 0; c < colCount; c++) {
      const rawName = (headerRow[c] ?? "").trim();
      const baseName = rawName.length > 0 ? rawName : `Column ${c + 1}`;
      let uniqueName = baseName;
      let suffix = 2;
      while (usedHeaders.has(uniqueName)) {
        uniqueName = `${baseName} (${suffix++})`;
      }
      usedHeaders.add(uniqueName);
      headers.push(uniqueName);
    }
    dataStartIndex = 1;
  } else {
    for (let c = 0; c < colCount; c++) {
      headers.push(`Column ${c + 1}`);
    }
  }

  const rows: Record<string, string>[] = [];
  for (let r = dataStartIndex; r < nonBlankRows.length; r++) {
    const rawRow = nonBlankRows[r]!;
    const record: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const header = headers[c]!;
      record[header] = rawRow[c] ?? "";
    }
    rows.push(record);
  }

  if (rows.length === 0) {
    return { ok: false, error: "CSV file contains no data rows." };
  }

  return { ok: true, delimiter, headers, rows };
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null && !Array.isArray(val) && !(val instanceof Date);
}

export interface JsonArrayCandidate {
  path: string;
  label: string;
  items: unknown[];
}

export function discoverJsonArrayPaths(root: unknown, maxDepth = 4): JsonArrayCandidate[] {
  if (Array.isArray(root)) {
    return [
      {
        path: "",
        label: `(Root Array) (${root.length} item${root.length === 1 ? "" : "s"})`,
        items: root,
      },
    ];
  }

  if (!isPlainObject(root)) {
    return [];
  }

  const candidates: Array<JsonArrayCandidate & { depth: number; order: number }> = [];
  const queue: Array<{ node: Record<string, unknown>; prefix: string; depth: number }> = [
    { node: root, prefix: "", depth: 0 },
  ];
  let order = 0;

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const [key, val] of Object.entries(current.node)) {
      const path = current.prefix ? `${current.prefix}.${key}` : key;
      if (Array.isArray(val)) {
        candidates.push({
          path,
          label: `${path} (${val.length} item${val.length === 1 ? "" : "s"})`,
          items: val,
          depth: current.depth + 1,
          order: order++,
        });
      } else if (isPlainObject(val) && current.depth + 1 < maxDepth) {
        queue.push({ node: val, prefix: path, depth: current.depth + 1 });
      }
    }
  }

  candidates.sort((a, b) => {
    const aEmpty = a.items.length === 0 ? 1 : 0;
    const bEmpty = b.items.length === 0 ? 1 : 0;
    if (aEmpty !== bEmpty) return aEmpty - bEmpty;
    const aIsLinks = a.path === "links" ? 0 : 1;
    const bIsLinks = b.path === "links" ? 0 : 1;
    if (aIsLinks !== bIsLinks) return aIsLinks - bIsLinks;
    if (a.depth !== b.depth) return a.depth - b.depth;
    return a.order - b.order;
  });

  return candidates.map(({ path, label, items }) => ({ path, label, items }));
}

export function getFieldByPath(item: unknown, path: string): unknown {
  if (!path) return undefined;
  if (path === "$value") return item;
  if (!isPlainObject(item)) return undefined;
  if (Object.prototype.hasOwnProperty.call(item, path)) {
    return item[path];
  }

  const segments = path.split(".");
  let cursor: unknown = item;
  for (const segment of segments) {
    if (!isPlainObject(cursor) || !Object.prototype.hasOwnProperty.call(cursor, segment)) {
      return undefined;
    }
    cursor = cursor[segment];
  }
  return cursor;
}

function collectObjectFieldPaths(
  obj: Record<string, unknown>,
  prefix: string,
  depth: number,
  maxDepth: number,
  out: Set<string>
): void {
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(val) && depth < maxDepth) {
      const childKeys = Object.keys(val);
      if (childKeys.length > 0) {
        collectObjectFieldPaths(val, path, depth + 1, maxDepth, out);
        continue;
      }
    }
    out.add(path);
  }
}

export function discoverSourceFields(items: unknown[], sampleLimit = 100): string[] {
  const fields = new Set<string>();
  const limit = Math.min(items.length, sampleLimit);
  for (let i = 0; i < limit; i++) {
    const item = items[i];
    if (item === null || item === undefined) continue;
    if (isPlainObject(item)) {
      collectObjectFieldPaths(item, "", 1, 3, fields);
    } else if (typeof item !== "object") {
      fields.add("$value");
    }
  }
  return Array.from(fields);
}

const FIELD_ALIAS_MAP: Record<ImportTargetField, readonly string[]> = {
  targetUrl: [
    "targeturl",
    "url",
    "longurl",
    "destination",
    "destinationurl",
    "target",
    "href",
    "link",
    "originalurl",
    "$value",
  ],
  slug: ["slug", "short", "shortcode", "alias", "code", "keyword", "backhalf", "customslug"],
  title: ["title", "name", "label", "description"],
  statusCode: ["statuscode", "httpstatus", "redirecttype", "codehttp"],
  tags: ["tags", "tag", "labels", "categories"],
  isActive: ["isactive", "active", "enabled"],
  forwardQuery: ["forwardquery", "passquery", "preservequery", "forwardparams"],
  expiresAt: ["expiresat", "expires", "expiry", "expiration", "expirationdate", "expireat"],
  createdAt: ["createdat", "created", "datecreated", "createddate", "timestamp"],
  updatedAt: ["updatedat", "updated", "modified", "modifiedat", "lastmodified"],
};

function normalizeFieldName(name: string): string {
  const leaf = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1) : name;
  return leaf.toLowerCase().replace(/[^a-z0-9$]/g, "");
}

export function autoDetectFieldMapping(sourceFields: string[]): ImportFieldMapping {
  const normalizedPairs = sourceFields.map((field) => ({
    field,
    norm: normalizeFieldName(field),
    isNested: field.includes("."),
  }));

  const mapping = {} as ImportFieldMapping;
  const usedFields = new Set<string>();
  const unmatched: ImportableFieldDescriptor[] = [];

  for (const descriptor of IMPORTABLE_LINK_FIELDS) {
    const aliases = FIELD_ALIAS_MAP[descriptor.key];
    let matched: string | undefined;

    for (const alias of aliases) {
      const hit =
        normalizedPairs.find((p) => !p.isNested && !usedFields.has(p.field) && p.norm === alias) ??
        normalizedPairs.find((p) => p.isNested && !usedFields.has(p.field) && p.norm === alias);
      if (hit) {
        matched = hit.field;
        break;
      }
    }

    if (matched) {
      usedFields.add(matched);
      mapping[descriptor.key] = { mode: "field", sourceField: matched };
    } else {
      unmatched.push(descriptor);
    }
  }

  for (const descriptor of unmatched) {
    if (descriptor.required) {
      const fallbackField = sourceFields.find((f) => !usedFields.has(f)) ?? sourceFields[0] ?? "";
      if (fallbackField) {
        usedFields.add(fallbackField);
      }
      mapping[descriptor.key] = {
        mode: "field",
        sourceField: fallbackField,
      };
    } else {
      mapping[descriptor.key] = { mode: "omit" };
    }
  }

  return mapping;
}

function coerceBooleanValue(
  raw: unknown
): { ok: true; value: boolean | undefined } | { ok: false; error: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, value: undefined };
  }
  if (typeof raw === "boolean") {
    return { ok: true, value: raw };
  }
  if (typeof raw === "number") {
    if (raw === 1) return { ok: true, value: true };
    if (raw === 0) return { ok: true, value: false };
    return { ok: false, error: `Invalid boolean number "${raw}".` };
  }
  if (typeof raw === "string") {
    const trimmed = raw.trim().toLowerCase();
    if (trimmed === "") return { ok: true, value: undefined };
    if (["true", "1", "yes", "y", "active", "enabled", "on"].includes(trimmed)) {
      return { ok: true, value: true };
    }
    if (["false", "0", "no", "n", "inactive", "disabled", "off"].includes(trimmed)) {
      return { ok: true, value: false };
    }
    return { ok: false, error: `Invalid boolean value "${raw.trim().slice(0, 32)}".` };
  }
  return { ok: false, error: `Unsupported boolean value (${typeof raw}).` };
}

function coerceTagsValue(
  raw: unknown
): { ok: true; value: string[] | undefined } | { ok: false; error: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, value: undefined };
  }

  let rawStrings: string[];
  if (Array.isArray(raw)) {
    rawStrings = [];
    for (const item of raw) {
      if (item === null || item === undefined) continue;
      if (typeof item === "string") {
        const s = item.trim();
        if (s.length > 0) rawStrings.push(s);
      } else if (typeof item === "number" || typeof item === "boolean") {
        rawStrings.push(String(item));
      } else if (isPlainObject(item)) {
        const named = item["name"] ?? item["label"] ?? item["tag"] ?? item["value"];
        if (typeof named === "string") {
          const s = named.trim();
          if (s.length > 0) rawStrings.push(s);
        } else {
          return { ok: false, error: "Invalid tag object in tags array." };
        }
      } else {
        return { ok: false, error: "Invalid tag item in tags array." };
      }
    }
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") {
      return { ok: true, value: undefined };
    }
    let parsedArray: unknown = null;
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      try {
        parsedArray = JSON.parse(trimmed);
      } catch {
        parsedArray = null;
      }
    }
    if (Array.isArray(parsedArray)) {
      return coerceTagsValue(parsedArray);
    }
    rawStrings = trimmed
      .split(/[,;|]+/)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  } else {
    return { ok: false, error: `Unsupported tags value (${typeof raw}).` };
  }

  const parsed = tagsSchema.safeParse(rawStrings);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid tags." };
  }
  return { ok: true, value: parsed.data };
}

function coerceStatusCodeValue(
  raw: unknown
): { ok: true; value: ImportLinkInput["statusCode"] | undefined } | { ok: false; error: string } {
  if (raw === undefined || raw === null) {
    return { ok: true, value: undefined };
  }
  let num: number;
  if (typeof raw === "number") {
    num = raw;
  } else if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed === "") return { ok: true, value: undefined };
    if (!/^\d+$/.test(trimmed)) {
      return { ok: false, error: `Invalid statusCode "${trimmed.slice(0, 16)}".` };
    }
    num = Number(trimmed);
  } else {
    return { ok: false, error: `Unsupported statusCode value (${typeof raw}).` };
  }

  const parsed = statusCodeSchema.safeParse(num);
  if (!parsed.success) {
    return { ok: false, error: `statusCode must be 301, 302, 307, or 308 (got ${num}).` };
  }
  return { ok: true, value: parsed.data };
}

function resolveRawFieldValue(row: unknown, entry: FieldMappingEntry): unknown {
  if (entry.mode === "omit") {
    return undefined;
  }
  if (entry.mode === "constant") {
    return entry.constantValue;
  }
  if (!entry.sourceField) {
    return undefined;
  }
  return getFieldByPath(row, entry.sourceField);
}

export interface ValidTransformedImportItem {
  originalIndex: number;
  link: ImportLinkInput;
}

export interface TransformMappedRowsResult {
  validItems: ValidTransformedImportItem[];
  clientErrors: ImportItemError[];
  clientFailedResults: ImportItemResult[];
  previewRows: ValidTransformedImportItem[];
}

export function transformMappedRows(
  rows: unknown[],
  mapping: ImportFieldMapping,
  options?: { ownHostnames?: string[]; previewLimit?: number }
): TransformMappedRowsResult {
  const validItems: ValidTransformedImportItem[] = [];
  const clientErrors: ImportItemError[] = [];
  const clientFailedResults: ImportItemResult[] = [];
  const ownHostnames = options?.ownHostnames ?? [];
  const previewLimit = options?.previewLimit ?? 3;

  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    const candidate: Record<string, unknown> = {};
    let rowErrorCode = "validation_error";
    let rowErrorMessage: string | null = null;
    let extractedSlug: string | null = null;

    // Resolve slug early for error attribution
    const rawSlug = resolveRawFieldValue(row, mapping.slug);
    if (typeof rawSlug === "string" || typeof rawSlug === "number") {
      const cleaned = String(rawSlug).trim().replace(/^\/+/, "");
      if (cleaned.length > 0) {
        extractedSlug = cleaned;
      }
    }

    // 1. targetUrl (required)
    const rawTargetUrl = resolveRawFieldValue(row, mapping.targetUrl);
    if (typeof rawTargetUrl !== "string" || rawTargetUrl.trim() === "") {
      rowErrorMessage = "targetUrl: Target URL is required.";
    } else {
      const parsedUrl = targetUrlSchema.safeParse(rawTargetUrl);
      if (!parsedUrl.success) {
        rowErrorMessage = `targetUrl: ${parsedUrl.error.issues[0]?.message ?? "Invalid target URL."}`;
      } else {
        const hostCheck = validateTargetUrl(parsedUrl.data, ownHostnames);
        if (!hostCheck.ok) {
          rowErrorCode = "invalid_target_url";
          rowErrorMessage = `targetUrl: ${hostCheck.error}`;
        } else {
          candidate["targetUrl"] = parsedUrl.data;
        }
      }
    }

    // 2. slug (optional)
    if (!rowErrorMessage && mapping.slug.mode !== "omit") {
      if (rawSlug !== undefined && rawSlug !== null) {
        if (typeof rawSlug !== "string" && typeof rawSlug !== "number") {
          rowErrorMessage = "slug: Slug must be a string.";
        } else {
          const trimmed = String(rawSlug).trim();
          if (trimmed.length > 0) {
            const cleaned = trimmed.replace(/^\/+/, "");
            const parsedSlug = slugSchema.safeParse(cleaned);
            if (!parsedSlug.success) {
              rowErrorMessage = `slug: ${parsedSlug.error.issues[0]?.message ?? "Invalid slug."}`;
            } else {
              candidate["slug"] = parsedSlug.data;
              extractedSlug = parsedSlug.data;
            }
          }
        }
      }
    }

    // 3. title (optional)
    if (!rowErrorMessage && mapping.title.mode !== "omit") {
      const rawTitle = resolveRawFieldValue(row, mapping.title);
      if (rawTitle === null && mapping.title.mode === "field") {
        candidate["title"] = null;
      } else if (rawTitle !== undefined && rawTitle !== null) {
        if (
          typeof rawTitle !== "string" &&
          typeof rawTitle !== "number" &&
          typeof rawTitle !== "boolean"
        ) {
          rowErrorMessage = "title: Title must be a string.";
        } else {
          const strTitle = typeof rawTitle === "string" ? rawTitle : String(rawTitle);
          if (strTitle.trim() !== "") {
            const parsedTitle = titleSchema.safeParse(strTitle);
            if (!parsedTitle.success) {
              rowErrorMessage = `title: ${parsedTitle.error.issues[0]?.message ?? "Invalid title."}`;
            } else {
              candidate["title"] = parsedTitle.data;
            }
          }
        }
      }
    }

    // 4. statusCode (optional)
    if (!rowErrorMessage && mapping.statusCode.mode !== "omit") {
      const rawStatus = resolveRawFieldValue(row, mapping.statusCode);
      const statusRes = coerceStatusCodeValue(rawStatus);
      if (!statusRes.ok) {
        rowErrorMessage = `statusCode: ${statusRes.error}`;
      } else if (statusRes.value !== undefined) {
        candidate["statusCode"] = statusRes.value;
      }
    }

    // 5. tags (optional)
    if (!rowErrorMessage && mapping.tags.mode !== "omit") {
      const rawTags = resolveRawFieldValue(row, mapping.tags);
      const tagsRes = coerceTagsValue(rawTags);
      if (!tagsRes.ok) {
        rowErrorMessage = `tags: ${tagsRes.error}`;
      } else if (tagsRes.value !== undefined) {
        candidate["tags"] = tagsRes.value;
      }
    }

    // 6. isActive & forwardQuery (optional booleans)
    for (const boolField of ["isActive", "forwardQuery"] as const) {
      if (!rowErrorMessage && mapping[boolField].mode !== "omit") {
        const rawBool = resolveRawFieldValue(row, mapping[boolField]);
        const boolRes = coerceBooleanValue(rawBool);
        if (!boolRes.ok) {
          rowErrorMessage = `${boolField}: ${boolRes.error}`;
        } else if (boolRes.value !== undefined) {
          candidate[boolField] = boolRes.value;
        }
      }
    }

    // 7. Timestamp fields (optional)
    for (const tsField of ["expiresAt", "createdAt", "updatedAt"] as const) {
      if (!rowErrorMessage && mapping[tsField].mode !== "omit") {
        const rawTs = resolveRawFieldValue(row, mapping[tsField]);
        if (rawTs === null && tsField === "expiresAt" && mapping[tsField].mode === "field") {
          candidate[tsField] = null;
        } else if (
          rawTs !== undefined &&
          rawTs !== null &&
          !(typeof rawTs === "string" && rawTs.trim() === "")
        ) {
          const tsRes = parseImportTimestamp(rawTs);
          if (!tsRes.ok) {
            rowErrorMessage = `${tsField}: ${tsRes.error}`;
          } else if (tsRes.value !== null) {
            candidate[tsField] = tsRes.value;
          }
        }
      }
    }

    if (!rowErrorMessage) {
      const finalCheck = importLinkItemSchema.safeParse(candidate);
      if (!finalCheck.success) {
        const issue = finalCheck.error.issues[0];
        const prefix = issue && issue.path.length > 0 ? `${issue.path.join(".")}: ` : "";
        rowErrorMessage = `${prefix}${issue?.message ?? "Invalid link entry."}`;
      } else {
        const cleanLink: ImportLinkInput = { targetUrl: finalCheck.data.targetUrl };
        if (finalCheck.data.slug !== undefined) cleanLink.slug = finalCheck.data.slug;
        if (finalCheck.data.title !== undefined) cleanLink.title = finalCheck.data.title;
        if (finalCheck.data.statusCode !== undefined) cleanLink.statusCode = finalCheck.data.statusCode;
        if (finalCheck.data.tags !== undefined) cleanLink.tags = finalCheck.data.tags;
        if (finalCheck.data.isActive !== undefined) cleanLink.isActive = finalCheck.data.isActive;
        if (finalCheck.data.forwardQuery !== undefined) {
          cleanLink.forwardQuery = finalCheck.data.forwardQuery;
        }
        if (finalCheck.data.expiresAt !== undefined) cleanLink.expiresAt = finalCheck.data.expiresAt;
        if (finalCheck.data.createdAt !== undefined) cleanLink.createdAt = finalCheck.data.createdAt;
        if (finalCheck.data.updatedAt !== undefined) cleanLink.updatedAt = finalCheck.data.updatedAt;
        validItems.push({ originalIndex: index, link: cleanLink });
        continue;
      }
    }

    clientErrors.push({
      index,
      slug: extractedSlug,
      code: rowErrorCode,
      message: rowErrorMessage,
    });
    clientFailedResults.push({
      index,
      slug: extractedSlug ?? "",
      status: "failed",
      reason: rowErrorMessage,
    });
  }

  return {
    validItems,
    clientErrors,
    clientFailedResults,
    previewRows: validItems.slice(0, previewLimit),
  };
}

export function mergeClientAndServerImportReport(
  serverReport: ImportLinksResponse,
  validIndexMap: number[],
  clientErrors: ImportItemError[],
  clientFailedResults: ImportItemResult[],
  totalRows: number
): ImportLinksResponse {
  const mappedServerErrors = serverReport.errors.map((err) => ({
    ...err,
    index: validIndexMap[err.index] ?? err.index,
  }));
  const mappedServerResults = serverReport.results.map((res) => ({
    ...res,
    index: validIndexMap[res.index] ?? res.index,
  }));

  const errors = [...clientErrors, ...mappedServerErrors].sort((a, b) => a.index - b.index);
  const results = [...clientFailedResults, ...mappedServerResults].sort((a, b) => a.index - b.index);

  return {
    ...serverReport,
    summary: {
      total: totalRows,
      created: serverReport.summary.created,
      updated: serverReport.summary.updated,
      skipped: serverReport.summary.skipped,
      failed: serverReport.summary.failed + clientErrors.length,
    },
    errors,
    results,
  };
}
