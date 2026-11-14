import React, { useEffect, useRef, useState } from "react";
import type {
  ImportConflictMode,
  ImportLinkInput,
  ImportLinksResponse,
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
import { Label } from "@/components/ui/label";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  Copy,
  Loader2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

interface ImportLinksModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function ImportLinksModal({
  isOpen,
  onClose,
  onSuccess,
}: ImportLinksModalProps): React.ReactElement {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [fileName, setFileName] = useState<string>("");
  const [parsedLinks, setParsedLinks] = useState<ImportLinkInput[] | null>(null);
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

  function resetState() {
    setFileName("");
    setParsedLinks(null);
    setParseError(null);
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

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setReport(null);
    setPartialError(null);
    setCopiedSkipped(false);

    if (!file) {
      setFileName("");
      setParsedLinks(null);
      setParseError(null);
      return;
    }

    setFileName(file.name);
    try {
      const text = await file.text();
      const parsed = parseImportEnvelope(text);
      if (!parsed.ok) {
        setParsedLinks(null);
        setParseError(parsed.error);
      } else {
        setParsedLinks(parsed.links);
        setParseError(null);
      }
    } catch {
      setParsedLinks(null);
      setParseError("Failed to read the selected file.");
    }
  }

  async function handleStartImport() {
    if (!parsedLinks || parsedLinks.length === 0 || submitting) return;

    setSubmitting(true);
    setPartialError(null);
    setProgress({ processed: 0, total: parsedLinks.length });

    try {
      const result = await importLinksChunked(parsedLinks, {
        onConflict,
        onProgress: (processed, total) => {
          setProgress({ processed, total });
        },
      });

      setReport(result);

      if (result.summary.created > 0 || result.summary.updated > 0) {
        onSuccess();
      }

      if (result.summary.failed > 0) {
        toast.warning(
          `Import finished with ${result.summary.failed} failed item(s).`
        );
      } else if (result.summary.skipped > 0) {
        toast.success(
          `Imported ${result.summary.created + result.summary.updated} link(s); skipped ${result.summary.skipped} existing.`
        );
      } else {
        toast.success(
          `Successfully imported ${result.summary.created + result.summary.updated} link(s).`
        );
      }
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
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Upload className="w-5 h-5" />
            <span>Import Links (JSON)</span>
          </DialogTitle>
          <DialogDescription>
            Upload a versioned JSON export file to import links in batches. Analytics and tokens are excluded.
          </DialogDescription>
        </DialogHeader>

        {!report ? (
          <div className="space-y-4 pt-2">
            {/* File Picker */}
            <div className="space-y-1.5">
              <Label htmlFor="import-json-file">Export File (.json)</Label>
              <input
                ref={fileInputRef}
                id="import-json-file"
                type="file"
                accept=".json,application/json"
                onChange={handleFileChange}
                disabled={submitting}
                className="block w-full text-sm text-zinc-600 dark:text-zinc-300 file:mr-3 file:py-2 file:px-3.5 file:rounded-lg file:border file:border-zinc-200 dark:file:border-zinc-700 file:text-xs file:font-semibold file:bg-zinc-50 dark:file:bg-zinc-950 file:text-zinc-900 dark:file:text-zinc-100 hover:file:bg-zinc-100 dark:hover:file:bg-zinc-800 cursor-pointer disabled:opacity-50"
              />
              {fileName && parsedLinks && (
                <p className="text-xs text-emerald-700 dark:text-emerald-400 font-medium">
                  Loaded {parsedLinks.length} link(s) from {fileName}.
                </p>
              )}
              {parseError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-red-800 dark:text-red-300 text-xs">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                  <span>{parseError}</span>
                </div>
              )}
            </div>

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
                disabled={!parsedLinks || parsedLinks.length === 0 || submitting}
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
