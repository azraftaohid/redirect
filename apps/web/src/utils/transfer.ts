import {
  EXPORT_SCHEMA_VERSION,
  type ImportLinkInput,
  type LinksExportEnvelope,
} from "@redirect/shared";
import { exportAllLinks } from "@/api/client";

export function downloadJsonFile(data: unknown, filename: string): void {
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export async function exportAndDownloadLinks(options?: {
  search?: string;
  tag?: string;
  isActive?: "true" | "false";
  onProgress?: (fetchedCount: number) => void;
}): Promise<LinksExportEnvelope> {
  const envelope = await exportAllLinks(options);
  const datePart = envelope.exportedAt.slice(0, 10);
  downloadJsonFile(envelope, `redirect-links-${datePart}.json`);
  return envelope;
}

export function parseImportEnvelope(
  rawText: string
): { ok: true; links: ImportLinkInput[] } | { ok: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, error: "Invalid JSON file. Please upload a valid JSON export." };
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      error: "Import file must be a JSON object with 'version' and 'links' fields.",
    };
  }

  const record = parsed as Record<string, unknown>;
  if (record["version"] !== EXPORT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Unsupported export version (${String(record["version"] ?? "missing")}). Expected version ${EXPORT_SCHEMA_VERSION}.`,
    };
  }

  if (!Array.isArray(record["links"])) {
    return { ok: false, error: "Import JSON must contain a 'links' array." };
  }

  if (record["links"].length === 0) {
    return { ok: false, error: "The 'links' array in this file is empty." };
  }

  return { ok: true, links: record["links"] as ImportLinkInput[] };
}
