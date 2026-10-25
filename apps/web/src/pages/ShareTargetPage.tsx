import React, { useEffect, useState } from "react";
import { Link } from "wouter";
import type { LinkRecord } from "@redirect/shared";
import { listLinks, createLink } from "@/api/client";
import { extractSharedPayload } from "@/utils/share";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Share2,
  Copy,
  Check,
  ExternalLink,
  Loader2,
  AlertCircle,
  Sparkles,
  Link2,
  ArrowLeft,
} from "lucide-react";
import { toast } from "sonner";

export function ShareTargetPage(): React.ReactElement {
  const [targetUrl, setTargetUrl] = useState("");
  const [title, setTitle] = useState("");
  const [customSlug, setCustomSlug] = useState("");
  const [existingLink, setExistingLink] = useState<LinkRecord | null>(null);
  const [createdLink, setCreatedLink] = useState<LinkRecord | null>(null);
  const [checkingExisting, setCheckingExisting] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [copied, setCopied] = useState(false);

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

  // Debounced check for existing link when typing URL
  useEffect(() => {
    const trimmed = targetUrl.trim();
    if (!trimmed || !/^https?:\/\/.+/i.test(trimmed)) {
      setCheckingExisting(false);
      return;
    }

    const timer = setTimeout(() => {
      checkIfAlreadyExists(trimmed);
    }, 600);

    return () => clearTimeout(timer);
  }, [targetUrl]);

  async function checkIfAlreadyExists(url: string) {
    setCheckingExisting(true);
    try {
      const res = await listLinks({ search: url, limit: 10 });
      const exact = res.data.find((l) => l.targetUrl === url);
      if (exact) {
        setExistingLink(exact);
      }
    } catch {
      // Ignore background check failure
    } finally {
      setCheckingExisting(false);
    }
  }

  async function handleCreate(e?: React.FormEvent) {
    if (e) e.preventDefault();
    let target = targetUrl.trim();
    if (!target) return;

    if (!/^https?:\/\//i.test(target)) {
      target = "https://" + target;
    }

    try {
      new URL(target);
    } catch {
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
      toast.success(`Short link /${res.slug} created!`);

      // Auto-copy to clipboard for frictionless mobile workflow
      const full = `${window.location.origin}/${res.slug}`;
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(full).catch(() => {});
        setCopied(true);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create short link");
    } finally {
      setSubmitting(false);
    }
  }

  const activeLink = createdLink || existingLink;
  const fullShortUrl =
    activeLink && typeof window !== "undefined"
      ? `${window.location.origin}/${activeLink.slug}`
      : "";

  async function handleCopyShortUrl() {
    if (!fullShortUrl) return;
    try {
      await navigator.clipboard.writeText(fullShortUrl);
      setCopied(true);
      toast.success("Copied to clipboard!");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy");
    }
  }

  async function handleNativeShare() {
    if (!fullShortUrl || !navigator.share) return;
    try {
      await navigator.share({
        title: activeLink?.title || "Redirect Short Link",
        url: fullShortUrl,
      });
    } catch {
      // User cancelled share
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <Link href="/">
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs">
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
          <CardDescription>
            Instantly create a shareable short URL from your mobile device or browser.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4 pt-4">
          {/* If already created or exists */}
          {activeLink ? (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 text-center space-y-2">
                <p className="text-xs font-semibold text-emerald-800 dark:text-emerald-300">
                  {existingLink && !createdLink
                    ? "Existing short link found for this URL:"
                    : "Your short link is ready!"}
                </p>
                <p className="font-mono text-lg font-bold text-zinc-900 dark:text-zinc-50 select-all">
                  /{activeLink.slug}
                </p>
                <p className="text-xs text-zinc-500 dark:text-zinc-400 truncate max-w-sm mx-auto">
                  {activeLink.targetUrl}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <Button
                  onClick={handleCopyShortUrl}
                  className="gap-2 h-10 font-semibold"
                >
                  {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
                  <span>{copied ? "Copied!" : "Copy Short Link"}</span>
                </Button>

                {typeof navigator !== "undefined" && "share" in navigator ? (
                  <Button
                    variant="outline"
                    onClick={handleNativeShare}
                    className="gap-2 h-10 font-semibold"
                  >
                    <Share2 className="w-4 h-4" />
                    <span>Share via App</span>
                  </Button>
                ) : (
                  <Link href={`/links/${activeLink.id}`}>
                    <Button variant="outline" className="w-full gap-2 h-10">
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
                  }}
                  className="text-xs text-zinc-500 hover:text-zinc-900"
                >
                  Shorten another link
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleCreate} className="space-y-4">
              {/* Target URL */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="share-url">Target Destination URL</Label>
                  {checkingExisting && (
                    <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      <span>Checking...</span>
                    </div>
                  )}
                </div>
                <Input
                  id="share-url"
                  type="text"
                  placeholder="https://example.com/..."
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  disabled={submitting}
                  className="font-mono text-xs"
                />
              </div>

              {/* Title / Description */}
              <div className="space-y-1.5">
                <Label htmlFor="share-title">
                  Title <span className="text-zinc-400 font-normal">(optional)</span>
                </Label>
                <Input
                  id="share-title"
                  type="text"
                  placeholder="Page title or description"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  disabled={submitting}
                />
              </div>

              {/* Custom Slug */}
              <div className="space-y-1.5">
                <Label htmlFor="share-slug">
                  Custom Slug <span className="text-zinc-400 font-normal">(optional, default random)</span>
                </Label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-400 font-mono text-xs">
                    /
                  </div>
                  <Input
                    id="share-slug"
                    type="text"
                    placeholder="my-slug"
                    value={customSlug}
                    onChange={(e) => setCustomSlug(e.target.value)}
                    disabled={submitting}
                    className="pl-6 font-mono text-xs"
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={submitting || !targetUrl.trim()}
                className="w-full h-11 gap-2 font-semibold text-sm shadow-sm"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Shortening &amp; Copying...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 text-amber-300" />
                    <span>Shorten &amp; Copy</span>
                  </>
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
