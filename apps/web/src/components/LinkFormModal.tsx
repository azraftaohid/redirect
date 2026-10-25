import React, { useEffect, useState } from "react";
import type { CreateLinkInput, LinkRecord, UpdateLinkInput } from "@redirect/shared";
import { generateRandomSlug } from "@redirect/shared";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  toLocalDatetimeInputValue,
  fromLocalDatetimeInputValue,
} from "@/utils/dates";
import { createLink, updateLink } from "@/api/client";
import {
  AlertTriangle,
  Loader2,
  Sparkles,
  Link as LinkIcon,
  X,
} from "lucide-react";
import { toast } from "sonner";

interface LinkFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: (saved: LinkRecord) => void;
  initialLink?: LinkRecord | null;
}

export function LinkFormModal({
  isOpen,
  onClose,
  onSuccess,
  initialLink,
}: LinkFormModalProps): React.ReactElement {
  const isEditing = Boolean(initialLink);

  const [targetUrl, setTargetUrl] = useState("");
  const [slug, setSlug] = useState("");
  const [title, setTitle] = useState("");
  const [statusCode, setStatusCode] = useState<301 | 302 | 307 | 308>(307);
  const [isActive, setIsActive] = useState(true);
  const [forwardQuery, setForwardQuery] = useState(false);
  const [expiresAt, setExpiresAt] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen) {
      if (initialLink) {
        setTargetUrl(initialLink.targetUrl);
        setSlug(initialLink.slug);
        setTitle(initialLink.title || "");
        setStatusCode(initialLink.statusCode as 301 | 302 | 307 | 308);
        setIsActive(initialLink.isActive);
        setForwardQuery(initialLink.forwardQuery);
        setExpiresAt(toLocalDatetimeInputValue(initialLink.expiresAt));
        setTags(initialLink.tags || []);
      } else {
        setTargetUrl("");
        setSlug("");
        setTitle("");
        setStatusCode(307);
        setIsActive(true);
        setForwardQuery(false);
        setExpiresAt("");
        setTags([]);
      }
      setTagInput("");
      setErrors({});
    }
  }, [isOpen, initialLink]);

  function handleAddTag(value: string) {
    const trimmed = value.trim().toLowerCase().replace(/^#/, "");
    if (!trimmed) return;
    if (!tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
    }
    setTagInput("");
  }

  function handleRemoveTag(tagToRemove: string) {
    setTags(tags.filter((t) => t !== tagToRemove));
  }

  function handleTagKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === " ") {
      e.preventDefault();
      handleAddTag(tagInput);
    } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      setTags(tags.slice(0, -1));
    }
  }

  function handleGenerateSlug() {
    setSlug(generateRandomSlug(8));
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};

    let target = targetUrl.trim();
    if (!target) {
      errs.targetUrl = "Target URL is required";
    } else {
      if (!/^https?:\/\//i.test(target)) {
        target = "https://" + target;
        setTargetUrl(target);
      }
      try {
        new URL(target);
      } catch {
        errs.targetUrl = "Invalid URL format";
      }
    }

    if (slug.trim()) {
      if (!/^[a-zA-Z0-9_-]+$/.test(slug.trim())) {
        errs.slug = "Slug can only contain letters, numbers, hyphens, and underscores";
      }
    }

    if (expiresAt) {
      const e = new Date(expiresAt).getTime();
      if (e <= Date.now()) {
        errs.expiresAt = "Expiration date must be in the future";
      }
    }

    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;

    setSubmitting(true);

    let target = targetUrl.trim();
    if (!/^https?:\/\//i.test(target)) {
      target = "https://" + target;
    }

    const payload: CreateLinkInput = {
      targetUrl: target,
      slug: slug.trim() ? slug.trim() : undefined,
      title: title.trim() ? title.trim() : null,
      statusCode,
      isActive,
      forwardQuery,
      expiresAt: fromLocalDatetimeInputValue(expiresAt) ?? null,
      tags: tags.length > 0 ? tags : undefined,
    };

    try {
      let result: LinkRecord;
      if (isEditing && initialLink) {
        result = await updateLink(initialLink.id, payload as UpdateLinkInput);
        toast.success(`Updated link /${result.slug}`);
      } else {
        result = await createLink(payload);
        toast.success(`Created short link /${result.slug}`);
      }
      onSuccess(result);
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save link");
    } finally {
      setSubmitting(false);
    }
  }

  const isPermanent = statusCode === 301 || statusCode === 308;
  const isSlugChanged = isEditing && initialLink && slug.trim() !== initialLink.slug;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LinkIcon className="w-5 h-5" />
            <span>{isEditing ? `Edit Link /${initialLink?.slug}` : "Create Short Link"}</span>
          </DialogTitle>
          <DialogDescription>
            {isEditing
              ? "Modify destination URL, behavior, or parameters for this link."
              : "Create a branded short link with customizable status codes and expiration."}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Target URL */}
          <div className="space-y-1.5">
            <Label htmlFor="link-target-url">
              Target URL <span className="text-red-500">*</span>
            </Label>
            <Input
              id="link-target-url"
              type="text"
              placeholder="https://example.com/my-destination"
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              disabled={submitting}
            />
            {errors.targetUrl && <p className="text-xs text-red-500 font-medium">{errors.targetUrl}</p>}
          </div>

          {/* Title */}
          <div className="space-y-1.5">
            <Label htmlFor="link-title">
              Title <span className="text-zinc-400 font-normal">(optional description or label)</span>
            </Label>
            <Input
              id="link-title"
              type="text"
              placeholder="e.g. Documentation Portal"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={submitting}
            />
          </div>

          {/* Slug & Generator */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="link-slug">
                Custom Slug <span className="text-zinc-400 font-normal">(optional)</span>
              </Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleGenerateSlug}
                disabled={submitting}
                className="h-6 px-2 text-xs text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 gap-1"
              >
                <Sparkles className="w-3 h-3 text-amber-500" />
                <span>Generate random</span>
              </Button>
            </div>
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400 font-mono text-sm">
                /
              </div>
              <Input
                id="link-slug"
                type="text"
                placeholder="random8chars"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                disabled={submitting}
                className="pl-7 font-mono"
              />
            </div>
            {errors.slug && <p className="text-xs text-red-500 font-medium">{errors.slug}</p>}

            {isSlugChanged && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-amber-800 dark:text-amber-300 text-xs">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                <span>
                  Changing this slug will invalidate existing QR codes and external links referencing <code>/{initialLink?.slug}</code>.
                </span>
              </div>
            )}
          </div>

          {/* Status Code & Warning */}
          <div className="space-y-1.5">
            <Label htmlFor="link-status-code">HTTP Redirect Status Code</Label>
            <select
              id="link-status-code"
              value={statusCode}
              onChange={(e) => setStatusCode(Number(e.target.value) as 301 | 302 | 307 | 308)}
              disabled={submitting}
              className="w-full h-9 rounded-lg border border-zinc-200 bg-white px-3 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
            >
              <option value={307}>307 Temporary Redirect (Recommended - Preserves HTTP Method)</option>
              <option value={302}>302 Found (Standard Temporary)</option>
              <option value={308}>308 Permanent Redirect (Preserves HTTP Method)</option>
              <option value={301}>301 Moved Permanently (Browser Cached)</option>
            </select>

            {isPermanent && (
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-red-800 dark:text-red-300 text-xs">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                <span>
                  Permanent redirects (301 &amp; 308) are aggressively cached by browsers and intermediate proxies. Changing the destination later may not reach visitors whose browsers stored the cache.
                </span>
              </div>
            )}
          </div>

          {/* Active Switch & Forward Query Switch */}
          <div className="space-y-3 py-2 border-y border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center justify-between">
              <div>
                <Label htmlFor="link-active-switch" className="font-semibold">Link Status</Label>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  {isActive ? "Link is active and redirecting visitors." : "Link is inactive and will return 404."}
                </p>
              </div>
              <Switch
                id="link-active-switch"
                checked={isActive}
                onCheckedChange={setIsActive}
                disabled={submitting}
              />
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-zinc-100 dark:border-zinc-800/50">
              <div>
                <Label htmlFor="link-forward-query-switch" className="font-semibold">Forward Query Parameters</Label>
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Pass search parameters (e.g. <code>?utm_source=...</code>) directly to destination URL.
                </p>
              </div>
              <Switch
                id="link-forward-query-switch"
                checked={forwardQuery}
                onCheckedChange={setForwardQuery}
                disabled={submitting}
              />
            </div>
          </div>

          {/* Expiration Datetime */}
          <div className="space-y-1.5">
            <Label htmlFor="link-expires-at" className="text-xs">
              Expiration Date &amp; Time <span className="text-zinc-400 font-normal">(optional)</span>
            </Label>
            <Input
              id="link-expires-at"
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              disabled={submitting}
              className="text-xs"
            />
            {errors.expiresAt && <p className="text-xs text-red-500 font-medium">{errors.expiresAt}</p>}
          </div>

          {/* Tags */}
          <div className="space-y-1.5">
            <Label htmlFor="link-tags">Tags</Label>
            <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 min-h-10">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-zinc-100 dark:bg-zinc-800 text-xs font-medium text-zinc-800 dark:text-zinc-200"
                >
                  #{t}
                  <button
                    type="button"
                    onClick={() => handleRemoveTag(t)}
                    className="hover:text-red-500 focus:outline-none"
                    aria-label={`Remove tag ${t}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </span>
              ))}
              <input
                id="link-tags"
                type="text"
                placeholder={tags.length === 0 ? "Add tags (press Enter or comma)..." : "Add more..."}
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={handleTagKeyDown}
                onBlur={() => handleAddTag(tagInput)}
                disabled={submitting}
                className="flex-1 min-w-[120px] bg-transparent text-sm focus:outline-none placeholder:text-zinc-400 dark:placeholder:text-zinc-500"
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <span>{isEditing ? "Save Changes" : "Create Link"}</span>
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
