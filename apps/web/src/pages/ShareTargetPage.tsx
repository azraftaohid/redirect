import React, { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import type { LinkRecord } from "@redirect/shared";
import { listLinks, createLink } from "@/api/client";
import { extractSharedPayload } from "@/utils/share";
import { normalizeUrlInput } from "@/utils/url";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Share2,
  Copy,
  Check,
  Loader2,
  ArrowLeft,
  Info,
} from "lucide-react";
import { toast } from "sonner";

export function ShareTargetPage(): React.ReactElement {
  const [targetUrl, setTargetUrl] = useState("");
  const [title, setTitle] = useState("");
  const [customSlug, setCustomSlug] = useState("");
  const [existingLink, setExistingLink] = useState<LinkRecord | null>(null);
  const [createdLink, setCreatedLink] = useState<LinkRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedExisting, setCopiedExisting] = useState(false);
  const lastCheckedUrlRef = useRef<string>("");

  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const payload = extractSharedPayload(params);

    if (payload.targetUrl) {
      setTargetUrl(payload.targetUrl);
      if (payload.title) {
        setTitle(payload.title);
      }
      checkIfAlreadyExists(payload.targetUrl);
    }
  }, []);

  async function checkIfAlreadyExists(url: string) {
    const normalized = normalizeUrlInput(url);
    if (!normalized) {
      setExistingLink(null);
      lastCheckedUrlRef.current = "";
      return;
    }
    if (lastCheckedUrlRef.current === normalized) {
      return;
    }
    lastCheckedUrlRef.current = normalized;
    try {
      const res = await listLinks({ targetUrl: normalized, limit: 1 });
      setExistingLink(res.data[0] || null);
    } catch {
      setExistingLink(null);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const target = normalizeUrlInput(targetUrl);
    if (!target) {
      toast.error("Invalid URL format");
      return;
    }

    setSubmitting(true);
    try {
      const res = await createLink({
        targetUrl: target,
        title: title.trim() || undefined,
        slug: customSlug.trim() || undefined,
      });
      setCreatedLink(res);
      toast.success(`Short link /${res.slug} created`);

      // Auto-copy to clipboard for frictionless mobile workflow
      const full = `${window.location.origin}/${res.slug}`;
      if (navigator.clipboard?.writeText) {
        try {
          await navigator.clipboard.writeText(full);
          setCopied(true);
        } catch {
          setCopied(false);
        }
      } else {
        setCopied(false);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create short link");
    } finally {
      setSubmitting(false);
    }
  }

  const fullShortUrl =
    createdLink && typeof window !== "undefined"
      ? `${window.location.origin}/${createdLink.slug}`
      : "";

  async function handleCopyShortUrl() {
    if (!fullShortUrl) return;
    try {
      await navigator.clipboard.writeText(fullShortUrl);
      setCopied(true);
      toast.success("Copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
      toast.error("Failed to copy");
    }
  }

  async function handleCopyExisting() {
    if (!existingLink || typeof window === "undefined") return;
    const url = `${window.location.origin}/${existingLink.slug}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedExisting(true);
      toast.success(`Copied /${existingLink.slug} to clipboard`);
      setTimeout(() => setCopiedExisting(false), 2000);
    } catch {
      setCopiedExisting(false);
      toast.error("Failed to copy");
    }
  }

  async function handleNativeShare() {
    if (!fullShortUrl || !navigator.share) return;
    try {
      await navigator.share({
        title: createdLink?.title || "Redirect Short Link",
        url: fullShortUrl,
      });
    } catch {
      // User cancelled share
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link href="/">
          <Button variant="ghost" size="sm" className="gap-1.5 text-sm">
            <ArrowLeft className="w-4 h-4" />
            <span>Dashboard</span>
          </Button>
        </Link>
        <span className="text-xs text-zinc-400 font-mono">Web Share Target</span>
      </div>

      <Card>
        <CardHeader className="text-center pb-2">
          <div className="w-12 h-12 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 mx-auto flex items-center justify-center mb-2 shadow-xs">
            <Share2 className="w-6 h-6" />
          </div>
          <CardTitle className="text-xl">Shorten Shared Link</CardTitle>
          <CardDescription className="text-sm">
            Create a branded short URL from your mobile device or browser.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5 pt-4">
          {createdLink ? (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 text-center space-y-2">
                <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">
                  Your short link is ready
                </p>
                <p className="font-mono text-xl font-bold text-zinc-900 dark:text-zinc-50 select-all">
                  /{createdLink.slug}
                </p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400 truncate max-w-md mx-auto">
                  {createdLink.targetUrl}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Button
                  onClick={handleCopyShortUrl}
                  className="gap-2 h-10 font-medium text-sm"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  <span>{copied ? "Copied" : "Copy Link"}</span>
                </Button>

                {typeof navigator !== "undefined" && "share" in navigator ? (
                  <Button
                    variant="outline"
                    onClick={handleNativeShare}
                    className="gap-2 h-10 font-medium text-sm"
                  >
                    <Share2 className="w-4 h-4" />
                    <span>Share</span>
                  </Button>
                ) : (
                  <Link href={`/links/${createdLink.id}`}>
                    <Button variant="outline" className="w-full gap-2 h-10 text-sm">
                      <span>View Analytics</span>
                    </Button>
                  </Link>
                )}
              </div>

              <div className="text-center pt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCreatedLink(null);
                    setExistingLink(null);
                    setTargetUrl("");
                    setTitle("");
                    setCustomSlug("");
                    lastCheckedUrlRef.current = "";
                  }}
                  className="text-sm text-zinc-500 hover:text-zinc-900"
                >
                  Shorten another link
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleCreate} className="space-y-4">
              {/* Target URL */}
              <div className="space-y-1.5">
                <Label htmlFor="share-url" className="text-sm">Target Destination URL</Label>
                <Input
                  id="share-url"
                  type="text"
                  placeholder="https://example.com/..."
                  value={targetUrl}
                  onChange={(e) => {
                    setTargetUrl(e.target.value);
                  }}
                  onBlur={() => {
                    if (targetUrl.trim()) {
                      checkIfAlreadyExists(targetUrl.trim());
                    }
                  }}
                  disabled={submitting}
                  className="text-sm font-mono"
                />
              </div>

              {/* Existing Link Notice (Callout without hiding the form) */}
              {existingLink && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 text-sm">
                  <div className="flex items-center gap-2 min-w-0">
                    <Info className="w-4 h-4 text-zinc-500 shrink-0" />
                    <span className="truncate text-zinc-700 dark:text-zinc-300">
                      Existing link found: <strong className="font-mono text-zinc-950 dark:text-zinc-50">/{existingLink.slug}</strong>
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCopyExisting}
                      className="h-7 px-2.5 text-xs gap-1"
                    >
                      {copiedExisting ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>Copy</span>
                    </Button>
                    <Link href={`/links/${existingLink.id}`}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                      >
                        Stats
                      </Button>
                    </Link>
                  </div>
                </div>
              )}

              {/* Title / Description */}
              <div className="space-y-1.5">
                <Label htmlFor="share-title" className="text-sm">
                  Title <span className="text-zinc-400 font-normal">(optional)</span>
                </Label>
                <Input
                  id="share-title"
                  type="text"
                  placeholder="Page title or description"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={submitting}
                  className="text-sm"
                />
              </div>

              {/* Custom Slug */}
              <div className="space-y-1.5">
                <Label htmlFor="share-slug" className="text-sm">
                  Custom Slug <span className="text-zinc-400 font-normal">(optional, default random)</span>
                </Label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400 font-mono text-sm">
                    /
                  </div>
                  <Input
                    id="share-slug"
                    type="text"
                    placeholder="my-slug"
                    value={customSlug}
                    onChange={(e) => setCustomSlug(e.target.value)}
                    disabled={submitting}
                    className="pl-7 font-mono text-sm"
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={submitting || !targetUrl.trim()}
                className="w-full h-10 font-medium text-sm shadow-xs"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    <span>Shortening...</span>
                  </>
                ) : (
                  <span>Shorten</span>
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
