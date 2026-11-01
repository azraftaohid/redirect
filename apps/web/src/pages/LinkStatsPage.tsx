import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "wouter";
import type { LinkRecord, LinkStats } from "@redirect/shared";
import { getLinkStats } from "@/api/client";
import { zeroFillDailySeries, formatCountryName } from "@/utils/stats";
import { formatDisplayDate, isLinkExpired } from "@/utils/dates";
import { DailyChart } from "@/components/DailyChart";
import { LinkFormModal } from "@/components/LinkFormModal";
import { QrCodeModal } from "@/components/QrCodeModal";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ArrowLeft,
  ExternalLink,
  Copy,
  Check,
  QrCode,
  Edit,
  RefreshCw,
  Loader2,
  Globe,
  Compass,
  Clock,
  MousePointerClick,
  Activity,
  AlertCircle,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";

export function LinkStatsPage(): React.ReactElement {
  const { id } = useParams<{ id: string }>();

  const [link, setLink] = useState<LinkRecord | null>(null);
  const [stats, setStats] = useState<LinkStats | null>(null);
  const [days, setDays] = useState<number>(30);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState(false);

  // Modals
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [qrModalOpen, setQrModalOpen] = useState(false);

  const fetchData = useCallback(
    async (showRefreshing = false) => {
      if (!id) return;
      if (showRefreshing) setRefreshing(true);
      else setLoading(true);

      try {
        const statsRes = await getLinkStats(id, days);
        setLink(statsRes.link);
        setStats(statsRes);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Failed to load link statistics");
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [id, days]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const shortUrl =
    typeof window !== "undefined" && link
      ? `${window.location.origin}/${link.slug}`
      : `/${link?.slug ?? ""}`;

  async function handleCopy() {
    if (!shortUrl) return;
    try {
      await navigator.clipboard.writeText(shortUrl);
      setCopied(true);
      toast.success("Copied short link to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy link");
    }
  }

  if (loading && !link) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-3">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
        <p className="text-sm font-medium text-zinc-400">Loading analytics...</p>
      </div>
    );
  }

  if (!link) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
        <AlertCircle className="w-12 h-12 text-zinc-400" />
        <h2 className="text-lg font-bold">Link Not Found</h2>
        <p className="text-sm text-zinc-500 max-w-sm">
          The short link you are looking for does not exist or may have been deleted.
        </p>
        <Link href="/">
          <Button size="sm" variant="outline" className="gap-2">
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Links</span>
          </Button>
        </Link>
      </div>
    );
  }

  const chartSeries = stats ? zeroFillDailySeries(stats.daily, stats.range.from, stats.range.to) : [];
  const expired = isLinkExpired(link.expiresAt);
  const periodClicks = stats?.daily ? stats.daily.reduce((sum, d) => sum + d.clicks, 0) : 0;
  let peakDay: { day: string; clicks: number } | null = null;
  if (stats?.daily && stats.daily.length > 0) {
    for (const d of stats.daily) {
      if (!peakDay || d.clicks > peakDay.clicks) {
        peakDay = d;
      }
    }
  }

  const hasCountry = stats?.dimensions?.country !== undefined;
  const hasReferrer = stats?.dimensions?.referrer !== undefined;
  const countries = stats?.dimensions?.country ?? [];
  const referrers = stats?.dimensions?.referrer ?? [];

  const maxCountryClicks = countries.length > 0 ? Math.max(...countries.map((c) => c.clicks)) : 1;
  const maxReferrerClicks = referrers.length > 0 ? Math.max(...referrers.map((r) => r.clicks)) : 1;

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/">
            <Button variant="ghost" size="icon" className="h-8 w-8" title="Back to links">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-bold tracking-tight font-mono">
                /{link.slug}
              </h1>
              <button
                type="button"
                onClick={handleCopy}
                className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
                title="Copy short link"
              >
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
              </button>
              {expired ? (
                <Badge variant="destructive" className="text-xs">Expired</Badge>
              ) : link.isActive ? (
                <Badge variant="success" className="text-xs">Active</Badge>
              ) : (
                <Badge variant="secondary" className="text-xs">Inactive</Badge>
              )}
              <Badge variant="outline" className="font-mono text-xs">
                {link.statusCode}
              </Badge>
              {link.forwardQuery && (
                <Badge variant="outline" className="text-xs">
                  Forward Query
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-1.5 text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
              {link.title && <span className="font-medium text-zinc-700 dark:text-zinc-300 mr-1">{link.title} &bull;</span>}
              <a
                href={link.targetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate hover:underline max-w-sm sm:max-w-md"
              >
                {link.targetUrl}
              </a>
              <ExternalLink className="w-3.5 h-3.5 shrink-0" />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchData(true)}
            disabled={refreshing}
            className="h-9 gap-1.5 text-sm"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
            <span>Refresh</span>
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setQrModalOpen(true)}
            disabled={refreshing}
            className="h-9 gap-1.5 text-sm"
          >
            <QrCode className="w-3.5 h-3.5" />
            <span>QR Code</span>
          </Button>

          <Button
            size="sm"
            onClick={() => setFormModalOpen(true)}
            className="h-9 gap-1.5 text-sm"
          >
            <Edit className="w-3.5 h-3.5" />
            <span>Edit Link</span>
          </Button>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0 p-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Total Clicks
            </CardTitle>
            <MousePointerClick className="w-4 h-4 text-zinc-400" />
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold font-mono">
              {link.clickCount.toLocaleString()}
            </div>
            <p className="text-xs text-zinc-400 mt-1">All-time redirects</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0 p-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Clicks in Period
            </CardTitle>
            <Activity className="w-4 h-4 text-zinc-400" />
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-2xl font-bold font-mono">
              {stats ? periodClicks.toLocaleString() : "—"}
            </div>
            <p className="text-xs text-zinc-400 mt-1">Last {days} days</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0 p-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Peak Day
            </CardTitle>
            <Calendar className="w-4 h-4 text-zinc-400" />
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-sm font-semibold truncate font-mono">
              {peakDay && peakDay.clicks > 0
                ? `${peakDay.day} (${peakDay.clicks.toLocaleString()})`
                : "—"}
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              {peakDay && peakDay.clicks > 0 ? "Highest single day" : "No clicks in period"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0 p-4">
            <CardTitle className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
              Last Clicked
            </CardTitle>
            <Clock className="w-4 h-4 text-zinc-400" />
          </CardHeader>
          <CardContent className="p-4 pt-0">
            <div className="text-sm font-semibold truncate">
              {formatDisplayDate(link.lastClickedAt)}
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              {link.lastClickedAt ? "Latest visitor" : "No visits yet"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Daily Time-Series Chart Card */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 pb-0">
          <div>
            <CardTitle className="text-base font-semibold">Redirect Activity</CardTitle>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-0.5">
              Daily click breakdown in UTC time
            </p>
          </div>

          {/* Period selector */}
          <div className="flex items-center gap-1 bg-zinc-100 dark:bg-zinc-800 p-1 rounded-lg">
            {[7, 30, 90, 365].map((period) => (
              <button
                key={period}
                type="button"
                onClick={() => setDays(period)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                  days === period
                    ? "bg-white dark:bg-zinc-950 text-zinc-950 dark:text-zinc-50 shadow-xs font-semibold"
                    : "text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"
                }`}
              >
                {period}d
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="p-5 pt-4">
          <DailyChart data={chartSeries} days={days} />
        </CardContent>
      </Card>

      {/* Dimension Breakdown Cards */}
      {(hasCountry || hasReferrer) ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Countries Breakdown */}
          {hasCountry && (
            <Card>
              <CardHeader className="p-5 pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Globe className="w-4 h-4 text-zinc-400" />
                  <span>Top Countries</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-5 pt-0 space-y-2.5">
                {countries.length === 0 ? (
                  <p className="text-xs text-zinc-400 py-4 text-center">No data in this period</p>
                ) : (
                  countries.map((c) => {
                    const pct = Math.round((c.clicks / maxCountryClicks) * 100);
                    return (
                      <div key={c.value} className="space-y-1">
                        <div className="flex items-center justify-between text-sm font-medium">
                          <span className="truncate">{formatCountryName(c.value)}</span>
                          <span className="font-mono text-zinc-500 dark:text-zinc-400 text-xs">
                            {c.clicks.toLocaleString()}
                          </span>
                        </div>
                        <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-zinc-900 dark:bg-zinc-100 h-full rounded-full transition-all duration-300"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          )}

          {/* Referrers Breakdown */}
          {hasReferrer && (
            <Card>
              <CardHeader className="p-5 pb-3">
                <CardTitle className="text-sm font-semibold flex items-center gap-2">
                  <Compass className="w-4 h-4 text-zinc-400" />
                  <span>Top Referrers</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-5 pt-0 space-y-2.5">
                {referrers.length === 0 ? (
                  <p className="text-xs text-zinc-400 py-4 text-center">No data in this period</p>
                ) : (
                  referrers.map((r) => {
                    const pct = Math.round((r.clicks / maxReferrerClicks) * 100);
                    const label =
                      r.value === "(direct)" || r.value === "" || r.value === "direct"
                        ? "Direct / none"
                        : r.value;
                    return (
                      <div key={r.value} className="space-y-1">
                        <div className="flex items-center justify-between text-sm font-medium">
                          <span className="truncate">{label}</span>
                          <span className="font-mono text-zinc-500 dark:text-zinc-400 text-xs">
                            {r.clicks.toLocaleString()}
                          </span>
                        </div>
                        <div className="w-full bg-zinc-100 dark:bg-zinc-800 h-1.5 rounded-full overflow-hidden">
                          <div
                            className="bg-zinc-900 dark:bg-zinc-100 h-full rounded-full transition-all duration-300"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                )}
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <p className="text-xs text-zinc-400 text-center py-2">
          Country and referrer breakdowns are disabled. Enable them by setting <code className="font-mono bg-zinc-100 dark:bg-zinc-800 px-1 py-0.5 rounded">ANALYTICS_DIMENSIONS="country,referrer"</code> in your Worker environment variables.
        </p>
      )}

      {/* Edit Modal */}
      <LinkFormModal
        isOpen={formModalOpen}
        onClose={() => setFormModalOpen(false)}
        onSuccess={(updated) => {
          setLink(updated);
          setStats((prev) => (prev ? { ...prev, link: updated } : null));
        }}
        initialLink={link}
      />

      {/* QR Modal */}
      {qrModalOpen && (
        <QrCodeModal
          isOpen={qrModalOpen}
          onClose={() => setQrModalOpen(false)}
          slug={link.slug}
          targetUrl={link.targetUrl}
        />
      )}
    </div>
  );
}
