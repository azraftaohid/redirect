import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  EXPORT_SCHEMA_VERSION,
  IMPORTABLE_LINK_FIELDS,
  autoDetectFieldMapping,
  discoverJsonArrayPaths,
  discoverSourceFields,
  getFieldByPath,
  importLinkItemSchema,
  mergeClientAndServerImportReport,
  parseCsvContent,
  transformMappedRows,
  type CsvDelimiter,
  type FieldMappingEntry,
  type FieldMappingMode,
  type ImportConflictMode,
  type ImportFieldMapping,
  type ImportLinkInput,
  type ImportLinksResponse,
  type ImportTargetField,
  type JsonArrayCandidate,
} from "@redirect/shared";
import { ImportChunkError, importLinksChunked } from "@/api/client";
import { parseImportEnvelope } from "@/utils/transfer";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Copy,
  Loader2,
  SlidersHorizontal,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

interface ImportLinksModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type ImportSourceFormat = "none" | "json-v1" | "json-dynamic" | "csv";
type CsvDelimiterOption = "auto" | CsvDelimiter;

const NATIVE_SELECT_CLASS =
  "w-full h-9 rounded-lg border border-zinc-200 bg-white px-2.5 text-xs shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 disabled:opacity-50 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100";

function formatSamplePreview(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  let str: string;
  if (typeof raw === "string") {
    str = raw;
  } else if (typeof raw === "number" || typeof raw === "boolean") {
    str = String(raw);
  } else {
    try {
      str = JSON.stringify(raw);
    } catch {
      str = String(raw);
    }
  }
  const compact = str.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.length > 28 ? `${compact.slice(0, 28)}...` : compact;
}

function getDefaultConstantValue(field: ImportTargetField): string {
  if (field === "statusCode") return "307";
  if (field === "isActive" || field === "forwardQuery") return "true";
  return "";
}

export function ImportLinksModal({
  isOpen,
  onClose,
  onSuccess,
}: ImportLinksModalProps): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const fileLoadSeqRef = useRef(0);

  const [fileName, setFileName] = useState<string>("");
  const [rawText, setRawText] = useState<string>("");
  const [sourceFormat, setSourceFormat] = useState<ImportSourceFormat>("none");
  const [customizeMapping, setCustomizeMapping] = useState<boolean>(false);

  const [parsedNativeLinks, setParsedNativeLinks] = useState<ImportLinkInput[] | null>(null);
  const [jsonArrayCandidates, setJsonArrayCandidates] = useState<JsonArrayCandidate[]>([]);
  const [selectedArrayPath, setSelectedArrayPath] = useState<string>("");
  const [isJsonObjectRoot, setIsJsonObjectRoot] = useState<boolean>(false);

  const [csvDelimiterOption, setCsvDelimiterOption] = useState<CsvDelimiterOption>("auto");
  const [csvHasHeader, setCsvHasHeader] = useState<boolean>(true);

  const [sourceFields, setSourceFields] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<unknown[]>([]);
  const [fieldMapping, setFieldMapping] = useState<ImportFieldMapping | null>(null);

  const [parseError, setParseError] = useState<string | null>(null);
  const [onConflict, setOnConflict] = useState<ImportConflictMode>("skip");
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState<{ processed: number; total: number } | null>(null);
  const [report, setReport] = useState<ImportLinksResponse | null>(null);
  const [partialError, setPartialError] = useState<string | null>(null);
  const [copiedSkipped, setCopiedSkipped] = useState(false);

  useEffect(() => {
    if (isOpen) {
      resetState();
    }
  }, [isOpen]);

  function clearParsedState() {
    setRawText("");
    setSourceFormat("none");
    setCustomizeMapping(false);
    setParsedNativeLinks(null);
    setJsonArrayCandidates([]);
    setSelectedArrayPath("");
    setIsJsonObjectRoot(false);
    setCsvDelimiterOption("auto");
    setCsvHasHeader(true);
    setSourceFields([]);
    setRawRows([]);
    setFieldMapping(null);
    setParseError(null);
  }

  function resetState() {
    fileLoadSeqRef.current++;
    setFileName("");
    clearParsedState();
    setOnConflict("skip");
    setSubmitting(false);
    setProgress(null);
    setReport(null);
    setPartialError(null);
    setCopiedSkipped(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  function applyArrayRows(items: unknown[], emptyMessage: string): boolean {
    if (items.length === 0) {
      setSourceFields([]);
      setRawRows([]);
      setFieldMapping(null);
      setParseError(emptyMessage);
      return false;
    }

    const fields = discoverSourceFields(items);
    if (fields.length === 0) {
      setSourceFields([]);
      setRawRows([]);
      setFieldMapping(null);
      setParseError("Selected array contains no mappable fields.");
      return false;
    }

    setSourceFields(fields);
    setRawRows(items);
    setFieldMapping(autoDetectFieldMapping(fields));
    setParseError(null);
    return true;
  }

  function parseCsvWithOptions(
    text: string,
    delimiterOption: CsvDelimiterOption,
    hasHeader: boolean
  ) {
    setSourceFormat("csv");
    const csvRes = parseCsvContent(text, {
      delimiter: delimiterOption === "auto" ? undefined : delimiterOption,
      hasHeader,
    });
    if (!csvRes.ok) {
      setSourceFields([]);
      setRawRows([]);
      setFieldMapping(null);
      setParseError(csvRes.error);
      return;
    }

    setSourceFields(csvRes.headers);
    setRawRows(csvRes.rows);
    setFieldMapping(autoDetectFieldMapping(csvRes.headers));
    setParseError(null);
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const loadSeq = ++fileLoadSeqRef.current;
    const file = e.target.files?.[0];
    setReport(null);
    setPartialError(null);
    setCopiedSkipped(false);
    clearParsedState();

    if (!file) {
      setFileName("");
      return;
    }

    setFileName(file.name);
    try {
      const text = await file.text();
      if (loadSeq !== fileLoadSeqRef.current) return;
      setRawText(text);

      const lowerName = file.name.toLowerCase();
      let parsedJson: unknown;
      let isJsonValid = false;

      try {
        parsedJson = JSON.parse(text);
        isJsonValid = true;
      } catch {
        isJsonValid = false;
      }

      if (isJsonValid) {
        const isObjRoot =
          Boolean(parsedJson) && typeof parsedJson === "object" && !Array.isArray(parsedJson);
        const candidates = discoverJsonArrayPaths(parsedJson);

        if (isObjRoot) {
          const obj = parsedJson as Record<string, unknown>;
          if (
            obj["version"] === EXPORT_SCHEMA_VERSION &&
            Array.isArray(obj["links"]) &&
            obj["links"].length > 0 &&
            obj["links"].every((item) => importLinkItemSchema.safeParse(item).success)
          ) {
            const nativeLinks = obj["links"] as ImportLinkInput[];
            const fields = discoverSourceFields(nativeLinks);
            setSourceFormat("json-v1");
            setCustomizeMapping(false);
            setParsedNativeLinks(nativeLinks);
            setIsJsonObjectRoot(true);
            setJsonArrayCandidates(candidates);
            setSelectedArrayPath("links");
            setRawRows(nativeLinks);
            setSourceFields(fields);
            setFieldMapping(autoDetectFieldMapping(fields));
            setParseError(null);
            return;
          }
        }

        if (candidates.length === 0) {
          setSourceFormat("none");
          if (
            isObjRoot &&
            "version" in (parsedJson as Record<string, unknown>) &&
            (parsedJson as Record<string, unknown>)["version"] !== EXPORT_SCHEMA_VERSION
          ) {
            const envelopeCheck = parseImportEnvelope(text);
            setParseError(
              !envelopeCheck.ok
                ? envelopeCheck.error
                : "JSON file does not contain an array of links to import."
            );
          } else {
            setParseError("JSON file does not contain an array of links to import.");
          }
          return;
        }

        const initialCandidate = candidates[0]!;
        setSourceFormat("json-dynamic");
        setIsJsonObjectRoot(isObjRoot);
        setJsonArrayCandidates(candidates);
        setSelectedArrayPath(initialCandidate.path);
        applyArrayRows(
          initialCandidate.items,
          initialCandidate.path
            ? `The '${initialCandidate.path}' array in this JSON file is empty.`
            : "The root JSON array is empty."
        );
        return;
      }

      if (lowerName.endsWith(".json")) {
        setParseError("Invalid JSON file. Please upload a valid JSON or CSV file.");
        return;
      }

      parseCsvWithOptions(text, "auto", true);
    } catch {
      if (loadSeq !== fileLoadSeqRef.current) return;
      clearParsedState();
      setParseError("Failed to read the selected file.");
    }
  }

  function handleArrayPathChange(nextPath: string) {
    setSelectedArrayPath(nextPath);
    const candidate = jsonArrayCandidates.find((c) => c.path === nextPath);
    if (!candidate) return;
    applyArrayRows(
      candidate.items,
      nextPath ? `The '${nextPath}' array in this JSON file is empty.` : "The root JSON array is empty."
    );
  }

  function handleCsvOptionsChange(nextDelimiter: CsvDelimiterOption, nextHasHeader: boolean) {
    setCsvDelimiterOption(nextDelimiter);
    setCsvHasHeader(nextHasHeader);
    if (rawText) {
      parseCsvWithOptions(rawText, nextDelimiter, nextHasHeader);
    }
  }

  function updateFieldMapping(field: ImportTargetField, updater: (prev: FieldMappingEntry) => FieldMappingEntry) {
    setFieldMapping((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [field]: updater(prev[field]),
      };
    });
  }

  function handleModeChange(field: ImportTargetField, mode: FieldMappingMode) {
    updateFieldMapping(field, (prev) => {
      if (mode === "omit") {
        return { mode: "omit" };
      }
      if (mode === "field") {
        return {
          mode: "field",
          sourceField: prev.sourceField || sourceFields[0] || "",
        };
      }
      return {
        mode: "constant",
        constantValue:
          prev.constantValue !== undefined ? prev.constantValue : getDefaultConstantValue(field),
      };
    });
  }

  const isMappingUiVisible =
    sourceFormat === "json-dynamic" ||
    sourceFormat === "csv" ||
    (sourceFormat === "json-v1" && customizeMapping);

  const ownHostnames = useMemo(
    () => (typeof window !== "undefined" ? [window.location.hostname] : []),
    []
  );

  const transformed = useMemo(() => {
    if (!isMappingUiVisible || !fieldMapping || rawRows.length === 0) {
      return null;
    }
    return transformMappedRows(rawRows, fieldMapping, { ownHostnames });
  }, [isMappingUiVisible, fieldMapping, rawRows, ownHostnames]);

  const isFastPathReady =
    sourceFormat === "json-v1" && !customizeMapping && Boolean(parsedNativeLinks?.length);
  const canStartImport =
    !submitting &&
    !parseError &&
    (isFastPathReady || (Boolean(transformed) && (transformed?.validItems.length ?? 0) > 0));

  function handleToggleCustomizeMapping() {
    if (customizeMapping && parsedNativeLinks) {
      const fields = discoverSourceFields(parsedNativeLinks);
      setCustomizeMapping(false);
      setSelectedArrayPath("links");
      setRawRows(parsedNativeLinks);
      setSourceFields(fields);
      setFieldMapping(autoDetectFieldMapping(fields));
      setParseError(null);
    } else {
      setCustomizeMapping(true);
    }
  }

  function notifyImportSummary(summary: ImportLinksResponse["summary"]) {
    if (summary.created > 0 || summary.updated > 0) {
      onSuccess();
    }

    if (summary.failed > 0) {
      toast.warning(`Import finished with ${summary.failed} failed item(s).`);
    } else if (summary.skipped > 0) {
      toast.success(
        `Imported ${summary.created + summary.updated} link(s); skipped ${summary.skipped} existing.`
      );
    } else {
      toast.success(
        `Successfully imported ${summary.created + summary.updated} link(s).`
      );
    }
  }

  async function handleStartImport() {
    if (!canStartImport) return;

    if (isFastPathReady && parsedNativeLinks) {
      setSubmitting(true);
      setPartialError(null);
      setProgress({ processed: 0, total: parsedNativeLinks.length });

      try {
        const result = await importLinksChunked(parsedNativeLinks, {
          onConflict,
          onProgress: (processed, total) => {
            setProgress({ processed, total });
          },
        });

        setReport(result);
        notifyImportSummary(result.summary);
      } catch (err) {
        if (err instanceof ImportChunkError) {
          setPartialError(err.message);
          if (err.partialResponse.summary.total > 0) {
            setReport(err.partialResponse);
            if (
              err.partialResponse.summary.created > 0 ||
              err.partialResponse.summary.updated > 0
            ) {
              onSuccess();
            }
          }
          toast.error(err.message);
        } else {
          const message = err instanceof Error ? err.message : "Failed to import links";
          setPartialError(message);
          toast.error(message);
        }
      } finally {
        setSubmitting(false);
      }
      return;
    }

    if (!transformed || transformed.validItems.length === 0) return;

    const linksToSubmit = transformed.validItems.map((item) => item.link);
    const validIndexMap = transformed.validItems.map((item) => item.originalIndex);

    setSubmitting(true);
    setPartialError(null);
    setProgress({ processed: 0, total: linksToSubmit.length });

    try {
      const serverResult = await importLinksChunked(linksToSubmit, {
        onConflict,
        onProgress: (processed, total) => {
          setProgress({ processed, total });
        },
      });

      const mergedReport = mergeClientAndServerImportReport(
        serverResult,
        validIndexMap,
        transformed.clientErrors,
        transformed.clientFailedResults,
        rawRows.length
      );

      setReport(mergedReport);
      notifyImportSummary(mergedReport.summary);
    } catch (err) {
      if (err instanceof ImportChunkError) {
        setPartialError(err.message);
        const processedValidCount = err.partialResponse.summary.total;
        if (processedValidCount > 0) {
          const lastProcessedOriginalIndex = validIndexMap[processedValidCount - 1] ?? -1;
          const scopedClientErrors = transformed.clientErrors.filter(
            (clientErr) => clientErr.index <= lastProcessedOriginalIndex
          );
          const scopedClientResults = transformed.clientFailedResults.filter(
            (clientRes) => clientRes.index <= lastProcessedOriginalIndex
          );
          const mergedPartial = mergeClientAndServerImportReport(
            err.partialResponse,
            validIndexMap,
            scopedClientErrors,
            scopedClientResults,
            processedValidCount + scopedClientErrors.length
          );
          setReport(mergedPartial);
          if (
            mergedPartial.summary.created > 0 ||
            mergedPartial.summary.updated > 0
          ) {
            onSuccess();
          }
        }
        toast.error(err.message);
      } else {
        const message = err instanceof Error ? err.message : "Failed to import links";
        setPartialError(message);
        toast.error(message);
      }
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCopySkippedSlugs() {
    if (!report || report.skippedSlugs.length === 0) return;
    try {
      await navigator.clipboard.writeText(report.skippedSlugs.join("\n"));
      setCopiedSkipped(true);
      toast.success("Copied skipped slugs to clipboard");
      setTimeout(() => setCopiedSkipped(false), 2000);
    } catch {
      toast.error("Failed to copy skipped slugs");
    }
  }

  const progressPercent =
    progress && progress.total > 0
      ? Math.round((progress.processed / progress.total) * 100)
      : 0;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !submitting) {
          onClose();
        }
      }}
    >
      <DialogContent
        className={`${
          isMappingUiVisible && !report ? "sm:max-w-3xl" : "sm:max-w-xl"
        } max-h-[90vh] overflow-y-auto`}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            <span>Import Links (JSON / CSV)</span>
          </DialogTitle>
          <DialogDescription>
            Upload a Redirect JSON export, custom JSON array/object, or CSV file to map fields and import links in batches.
          </DialogDescription>
        </DialogHeader>

        {!report ? (
          <div className="space-y-4 pt-2">
            {/* File Picker */}
            <div className="space-y-1.5">
              <Label htmlFor="import-json-file">Import File (.json, .csv)</Label>
              <input
                ref={fileInputRef}
                id="import-json-file"
                type="file"
                accept=".json,.csv,application/json,text/csv"
                onChange={handleFileChange}
                disabled={submitting}
                className="block w-full text-sm text-zinc-600 dark:text-zinc-300 file:mr-3 file:py-2 file:px-3.5 file:rounded-lg file:border file:border-zinc-200 dark:file:border-zinc-700 file:text-xs file:font-semibold file:bg-zinc-50 dark:file:bg-zinc-950 file:text-zinc-900 dark:file:text-zinc-100 hover:file:bg-zinc-100 dark:hover:file:bg-zinc-800 cursor-pointer disabled:opacity-50"
              />

              {fileName && sourceFormat === "json-v1" && parsedNativeLinks && (
                <div className="flex flex-wrap items-center justify-between gap-2 pt-0.5">
                  <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                    Loaded {parsedNativeLinks.length} link(s) from {fileName}.
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleToggleCustomizeMapping}
                    disabled={submitting}
                    className="h-7 px-2 text-xs gap-1"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5" />
                    <span>
                      {customizeMapping ? "Use standard export mapping" : "Customize mapping & constants"}
                    </span>
                  </Button>
                </div>
              )}

              {fileName && (sourceFormat === "json-dynamic" || sourceFormat === "csv") && !parseError && (
                <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                  Loaded {rawRows.length} row(s) from {fileName} ({sourceFormat === "csv" ? "CSV" : "JSON"}).
                </p>
              )}

              {parseError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-red-800 dark:text-red-300 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                  <span>{parseError}</span>
                </div>
              )}
            </div>

            {/* JSON Array Property Selector */}
            {isMappingUiVisible && isJsonObjectRoot && jsonArrayCandidates.length > 0 && (
              <div className="space-y-1.5 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/60 p-3">
                <Label htmlFor="import-json-array-path" className="text-xs font-semibold">
                  Array Property in JSON Object
                </Label>
                <select
                  id="import-json-array-path"
                  value={selectedArrayPath}
                  onChange={(e) => handleArrayPathChange(e.target.value)}
                  disabled={submitting}
                  className={NATIVE_SELECT_CLASS}
                >
                  {jsonArrayCandidates.map((candidate) => (
                    <option key={candidate.path} value={candidate.path}>
                      {candidate.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* CSV Parsing Options */}
            {isMappingUiVisible && sourceFormat === "csv" && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/70 dark:bg-zinc-950/60 p-3">
                <div className="space-y-1">
                  <Label htmlFor="import-csv-delimiter" className="text-xs font-semibold">
                    CSV Delimiter
                  </Label>
                  <select
                    id="import-csv-delimiter"
                    value={csvDelimiterOption}
                    onChange={(e) =>
                      handleCsvOptionsChange(e.target.value as CsvDelimiterOption, csvHasHeader)
                    }
                    disabled={submitting}
                    className={NATIVE_SELECT_CLASS}
                  >
                    <option value="auto">Auto-detect</option>
                    <option value=",">Comma (,)</option>
                    <option value=";">Semicolon (;)</option>
                    <option value={"\t"}>Tab (\t)</option>
                  </select>
                </div>

                <div className="flex items-end pb-1.5">
                  <label className="flex items-center gap-2 text-xs font-medium cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={csvHasHeader}
                      onChange={(e) =>
                        handleCsvOptionsChange(csvDelimiterOption, e.target.checked)
                      }
                      disabled={submitting}
                    />
                    <span>First row contains headers</span>
                  </label>
                </div>
              </div>
            )}

            {/* Dynamic Field Mapping & Constant Values */}
            {isMappingUiVisible && fieldMapping && rawRows.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label className="text-sm font-semibold">Field Mapping &amp; Constants</Label>
                  <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                    Timestamps accept ISO/SQL date strings and epoch seconds/ms.
                  </span>
                </div>

                <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 divide-y divide-zinc-100 dark:divide-zinc-800/80">
                  {IMPORTABLE_LINK_FIELDS.map((field) => {
                    const entry = fieldMapping[field.key];
                    const sampleRow = rawRows[0];

                    return (
                      <div
                        key={field.key}
                        className="p-2.5 grid grid-cols-1 sm:grid-cols-12 gap-2 items-start sm:items-center"
                      >
                        <div className="sm:col-span-4 space-y-0.5">
                          <div className="flex items-center gap-1.5 text-xs font-medium">
                            <span>{field.label}</span>
                            {field.required ? (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                Required
                              </Badge>
                            ) : (
                              <span className="text-[10px] text-zinc-400">Optional</span>
                            )}
                          </div>
                          <p className="text-[11px] text-zinc-500 dark:text-zinc-400 leading-tight">
                            {field.description}
                          </p>
                        </div>

                        <div className="sm:col-span-3">
                          <select
                            aria-label={`Mapping mode for ${field.key}`}
                            value={entry.mode}
                            onChange={(e) =>
                              handleModeChange(field.key, e.target.value as FieldMappingMode)
                            }
                            disabled={submitting}
                            className={NATIVE_SELECT_CLASS}
                          >
                            {!field.required && (
                              <option value="omit">
                                {field.key === "slug" ? "Auto-generate (Omit)" : "Default / Omit"}
                              </option>
                            )}
                            <option value="field">Map from field</option>
                            {field.allowConstant && (
                              <option value="constant">Constant value</option>
                            )}
                          </select>
                        </div>

                        <div className="sm:col-span-5">
                          {entry.mode === "omit" ? (
                            <div className="h-9 px-2.5 rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800 flex items-center text-xs text-zinc-400">
                              {field.key === "slug"
                                ? "Server generates random 6-char slug"
                                : "Use default (or keep existing on overwrite)"}
                            </div>
                          ) : entry.mode === "field" ? (
                            <select
                              aria-label={`Source field for ${field.key}`}
                              value={entry.sourceField ?? ""}
                              onChange={(e) =>
                                updateFieldMapping(field.key, (prev) => ({
                                  ...prev,
                                  sourceField: e.target.value,
                                }))
                              }
                              disabled={submitting}
                              className={NATIVE_SELECT_CLASS}
                            >
                              <option value="">-- Select source field --</option>
                              {sourceFields.map((sf) => {
                                const sample = formatSamplePreview(getFieldByPath(sampleRow, sf));
                                return (
                                  <option key={sf} value={sf}>
                                    {sample ? `${sf} (${sample})` : sf}
                                  </option>
                                );
                              })}
                            </select>
                          ) : field.kind === "statusCode" ? (
                            <select
                              aria-label={`Constant value for ${field.key}`}
                              value={entry.constantValue ?? "307"}
                              onChange={(e) =>
                                updateFieldMapping(field.key, (prev) => ({
                                  ...prev,
                                  constantValue: e.target.value,
                                }))
                              }
                              disabled={submitting}
                              className={NATIVE_SELECT_CLASS}
                            >
                              <option value="307">307 Temporary Redirect</option>
                              <option value="302">302 Found</option>
                              <option value="308">308 Permanent Redirect</option>
                              <option value="301">301 Moved Permanently</option>
                            </select>
                          ) : field.kind === "boolean" ? (
                            <select
                              aria-label={`Constant value for ${field.key}`}
                              value={entry.constantValue ?? "true"}
                              onChange={(e) =>
                                updateFieldMapping(field.key, (prev) => ({
                                  ...prev,
                                  constantValue: e.target.value,
                                }))
                              }
                              disabled={submitting}
                              className={NATIVE_SELECT_CLASS}
                            >
                              <option value="true">Enabled (true)</option>
                              <option value="false">Disabled (false)</option>
                            </select>
                          ) : (
                            <Input
                              aria-label={`Constant value for ${field.key}`}
                              type="text"
                              value={entry.constantValue ?? ""}
                              onChange={(e) =>
                                updateFieldMapping(field.key, (prev) => ({
                                  ...prev,
                                  constantValue: e.target.value,
                                }))
                              }
                              placeholder={
                                field.kind === "tags"
                                  ? "e.g. imported, campaign"
                                  : field.kind === "timestamp"
                                  ? "ISO date, YYYY-MM-DD, or epoch (e.g. 1735689600)"
                                  : field.kind === "url"
                                  ? "https://example.com/destination"
                                  : "Constant value for all rows"
                              }
                              disabled={submitting}
                              className="h-9 text-xs font-mono"
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Pre-flight Status & Live Preview */}
                {transformed && (
                  <div className="space-y-2.5">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-medium text-zinc-700 dark:text-zinc-300">
                        Ready to import{" "}
                        <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                          {transformed.validItems.length}
                        </span>{" "}
                        of <span className="font-mono">{rawRows.length}</span> row(s)
                      </span>
                      {transformed.clientErrors.length > 0 && (
                        <span className="font-medium text-amber-700 dark:text-amber-400">
                          {transformed.clientErrors.length} invalid row(s) will be recorded as failed
                        </span>
                      )}
                    </div>

                    {transformed.clientErrors.length > 0 && (
                      <div className="rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 p-2.5 space-y-1 text-xs text-amber-900 dark:text-amber-200">
                        <div className="flex items-center gap-1.5 font-semibold">
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0 text-amber-600" />
                          <span>
                            Pre-flight validation warnings ({transformed.clientErrors.length})
                          </span>
                        </div>
                        <div className="max-h-24 overflow-y-auto space-y-0.5 font-mono text-[11px]">
                          {transformed.clientErrors.slice(0, 8).map((err) => (
                            <div key={`${err.index}-${err.code}`}>
                              Row #{err.index + 1}: {err.message}
                            </div>
                          ))}
                          {transformed.clientErrors.length > 8 && (
                            <div className="font-sans text-amber-700 dark:text-amber-400">
                              ...and {transformed.clientErrors.length - 8} more invalid row(s).
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {transformed.previewRows.length > 0 && (
                      <div className="space-y-1">
                        <div className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                          Converted Output Preview (first {transformed.previewRows.length})
                        </div>
                        <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50/50 dark:bg-zinc-950/50">
                          <table className="w-full text-left text-[11px]">
                            <thead className="border-b border-zinc-200 dark:border-zinc-800 text-zinc-500 dark:text-zinc-400">
                              <tr>
                                <th className="py-1.5 px-2 font-medium">Row</th>
                                <th className="py-1.5 px-2 font-medium">Slug</th>
                                <th className="py-1.5 px-2 font-medium">Target URL</th>
                                <th className="py-1.5 px-2 font-medium">Meta / Timestamps (UTC)</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/80 font-mono">
                              {transformed.previewRows.map((item) => {
                                const metaParts: string[] = [];
                                if (item.link.statusCode !== undefined) {
                                  metaParts.push(`${item.link.statusCode}`);
                                }
                                if (item.link.tags && item.link.tags.length > 0) {
                                  metaParts.push(`[${item.link.tags.join(", ")}]`);
                                }
                                if (item.link.isActive !== undefined) {
                                  metaParts.push(`active=${item.link.isActive}`);
                                }
                                if (item.link.forwardQuery !== undefined) {
                                  metaParts.push(`fwd=${item.link.forwardQuery}`);
                                }
                                if (item.link.expiresAt !== undefined) {
                                  metaParts.push(`exp=${item.link.expiresAt ?? "null"}`);
                                }
                                if (item.link.createdAt !== undefined) {
                                  metaParts.push(`created=${item.link.createdAt}`);
                                }
                                if (item.link.updatedAt !== undefined) {
                                  metaParts.push(`updated=${item.link.updatedAt}`);
                                }

                                return (
                                  <tr key={item.originalIndex}>
                                    <td className="py-1.5 px-2 text-zinc-500">
                                      #{item.originalIndex + 1}
                                    </td>
                                    <td className="py-1.5 px-2">
                                      {item.link.slug ? (
                                        <span>/{item.link.slug}</span>
                                      ) : (
                                        <span className="text-zinc-400 font-sans italic">auto</span>
                                      )}
                                    </td>
                                    <td className="py-1.5 px-2 max-w-[220px] truncate">
                                      {item.link.targetUrl}
                                    </td>
                                    <td className="py-1.5 px-2 text-zinc-600 dark:text-zinc-300">
                                      {metaParts.length > 0 ? metaParts.join(" · ") : "defaults"}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Conflict Strategy */}
            <div className="space-y-2">
              <Label>When a slug already exists</Label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <label
                  className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                    onConflict === "skip"
                      ? "border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-950"
                      : "border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50/50 dark:hover:bg-zinc-950/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="import-conflict-mode"
                    value="skip"
                    checked={onConflict === "skip"}
                    onChange={() => setOnConflict("skip")}
                    disabled={submitting}
                    className="mt-1"
                  />
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium flex items-center gap-1.5">
                      <span>Skip existing</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        Default
                      </Badge>
                    </div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Keep existing links intact and report skipped slugs.
                    </p>
                  </div>
                </label>

                <label
                  className={`flex items-start gap-2.5 p-3 rounded-lg border cursor-pointer transition-colors ${
                    onConflict === "overwrite"
                      ? "border-zinc-900 dark:border-zinc-100 bg-zinc-50 dark:bg-zinc-950"
                      : "border-zinc-200 dark:border-zinc-800 hover:bg-zinc-50/50 dark:hover:bg-zinc-950/50"
                  }`}
                >
                  <input
                    type="radio"
                    name="import-conflict-mode"
                    value="overwrite"
                    checked={onConflict === "overwrite"}
                    onChange={() => setOnConflict("overwrite")}
                    disabled={submitting}
                    className="mt-1"
                  />
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium">Overwrite existing</div>
                    <p className="text-xs text-zinc-500 dark:text-zinc-400">
                      Update destination and provided metadata (omitted optional fields keep existing values) while keeping analytics.
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {partialError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-red-800 dark:text-red-300 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                <span>{partialError}</span>
              </div>
            )}

            {/* Progress */}
            {submitting && progress && (
              <div className="space-y-1.5 pt-1">
                <div className="flex items-center justify-between text-xs text-zinc-500 dark:text-zinc-400">
                  <span>Importing links...</span>
                  <span className="font-mono">
                    {progress.processed} / {progress.total} ({progressPercent}%)
                  </span>
                </div>
                <div className="w-full h-2 rounded-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">
                  <div
                    className="h-full bg-zinc-900 dark:bg-zinc-100 transition-all duration-200"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4 pt-2">
            {partialError && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-red-800 dark:text-red-300 text-xs">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                <div>
                  <div className="font-semibold">
                    Import interrupted before completing all chunks
                  </div>
                  <div>{partialError}</div>
                  <div className="mt-0.5 text-red-700/90 dark:text-red-300/90">
                    The summary below reflects links processed before the interruption.
                  </div>
                </div>
              </div>
            )}

            {/* Summary Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">Created</div>
                <div className="text-xl font-bold font-mono text-emerald-600 dark:text-emerald-400">
                  {report.summary.created}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">Updated</div>
                <div className="text-xl font-bold font-mono text-blue-600 dark:text-blue-400">
                  {report.summary.updated}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">Skipped</div>
                <div className="text-xl font-bold font-mono text-amber-600 dark:text-amber-400">
                  {report.summary.skipped}
                </div>
              </div>
              <div className="p-3 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-950">
                <div className="text-xs text-zinc-500 dark:text-zinc-400">Failed</div>
                <div className="text-xl font-bold font-mono text-red-600 dark:text-red-400">
                  {report.summary.failed}
                </div>
              </div>
            </div>

            {/* Skipped Slugs Report */}
            {report.skippedSlugs.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Skipped Slugs ({report.skippedSlugs.length})</span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleCopySkippedSlugs}
                    className="h-7 px-2.5 text-xs gap-1"
                  >
                    {copiedSkipped ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                    <span>{copiedSkipped ? "Copied" : "Copy Slugs"}</span>
                  </Button>
                </div>
                <div className="max-h-40 overflow-y-auto rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/30 p-2.5 flex flex-wrap gap-1.5">
                  {report.skippedSlugs.map((slug) => {
                    const slugResults = report.results.filter(
                      (r) => r.slug === slug && r.status === "skipped"
                    );
                    const hasExisting = slugResults.some((r) => r.reason === "slug_exists");
                    const duplicateCount = slugResults.filter(
                      (r) => r.reason === "duplicate_in_batch"
                    ).length;

                    let reasonLabel = "";
                    if (duplicateCount > 0 && !hasExisting) {
                      reasonLabel =
                        duplicateCount > 1
                          ? `duplicate in file x${duplicateCount}`
                          : "duplicate in file";
                    } else if (duplicateCount > 0 && hasExisting) {
                      reasonLabel = "existing + duplicate in file";
                    }

                    return (
                      <code
                        key={slug}
                        className="px-2 py-0.5 rounded bg-white dark:bg-zinc-900 border border-amber-200 dark:border-amber-800 font-mono text-xs text-amber-900 dark:text-amber-200 inline-flex items-center gap-1"
                      >
                        <span>/{slug}</span>
                        {reasonLabel ? (
                          <span className="font-sans text-[10px] text-amber-700 dark:text-amber-400">
                            ({reasonLabel})
                          </span>
                        ) : null}
                      </code>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Errors Report */}
            {report.errors.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center gap-1.5 text-sm font-semibold text-red-700 dark:text-red-300">
                  <AlertCircle className="w-4 h-4" />
                  <span>Failed Items ({report.errors.length})</span>
                </div>
                <div className="max-h-40 overflow-y-auto rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50/60 dark:bg-red-950/30 p-2.5 space-y-1.5 text-xs">
                  {report.errors.map((err) => (
                    <div
                      key={`${err.index}-${err.code}`}
                      className="text-red-800 dark:text-red-200 font-mono"
                    >
                      <span>Row #{err.index + 1}</span>
                      {err.slug ? <span> (/{err.slug})</span> : null}
                      <span>: {err.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter className="pt-2">
          {!report ? (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={onClose}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button
                type="button"
                onClick={handleStartImport}
                disabled={!canStartImport}
                className="gap-1.5"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Importing...</span>
                  </>
                ) : (
                  <>
                    <Upload className="w-4 h-4" />
                    <span>Import Links</span>
                  </>
                )}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={resetState}>
                Import Another File
              </Button>
              <Button type="button" onClick={onClose}>
                Done
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
