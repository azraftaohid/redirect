import React, { useCallback, useEffect, useState } from "react";
import type { LinkRecord, ListLinksQuery } from "@redirect/shared";
import { listLinks, createLink } from "@/api/client";
import { LinkRow } from "@/components/LinkRow";
import { LinkFormModal } from "@/components/LinkFormModal";
import { QrCodeModal } from "@/components/QrCodeModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Link2,
  Plus,
  Search,
  ChevronLeft,
  ChevronRight,
  Loader2,
  X,
} from "lucide-react";
import { toast } from "sonner";

const PAGE_SIZE = 20;

export function DashboardPage(): React.ReactElement {
  // Parse filters from URL
  const searchParams = new URLSearchParams(
    typeof window !== "undefined" ? window.location.search : ""
  );

  const initialSearch = searchParams.get("search") || "";
  const initialTag = searchParams.get("tag") || "";
  const initialStatus = searchParams.get("status") || "all";
  const initialSortBy = (searchParams.get("sortBy") as ListLinksQuery["sortBy"]) || "createdAt";
  const initialSortOrder = (searchParams.get("sortOrder") as ListLinksQuery["sortOrder"]) || "desc";
  const initialPage = Number(searchParams.get("page") || 1);

  const [search, setSearch] = useState(initialSearch);
  const [tag, setTag] = useState(initialTag);
  const [statusFilter, setStatusFilter] = useState<string>(initialStatus);
  const [sortBy, setSortBy] = useState<"createdAt" | "updatedAt" | "clickCount" | "slug">(initialSortBy);
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">(initialSortOrder);
  const [page, setPage] = useState<number>(initialPage);

  // Data state
  const [links, setLinks] = useState<LinkRecord[]>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [loading, setLoading] = useState(true);

  // Quick Shorten bar state
  const [quickUrl, setQuickUrl] = useState("");
  const [quickShortening, setQuickShortening] = useState(false);

  // Modals state
  const [formModalOpen, setFormModalOpen] = useState(false);
  const [editingLink, setEditingLink] = useState<LinkRecord | null>(null);
  const [qrModalLink, setQrModalLink] = useState<LinkRecord | null>(null);

  // Update URL search parameters when filters change
  const updateUrlParams = useCallback(
    (newParams: Record<string, string | number | undefined>) => {
      if (typeof window === "undefined") return;
      const sp = new URLSearchParams(window.location.search);
      Object.entries(newParams).forEach(([k, v]) => {
        if (
          v === undefined ||
          v === "" ||
          (k === "page" && v === 1) ||
          (k === "status" && v === "all") ||
          (k === "sortBy" && v === "createdAt") ||
          (k === "sortOrder" && v === "desc")
        ) {
          sp.delete(k);
        } else {
          sp.set(k, String(v));
        }
      });
      const qs = sp.toString();
      const pathname = window.location.pathname;
      const targetUrl = qs ? `${pathname}?${qs}` : pathname;
      const currentUrl = window.location.pathname + window.location.search;
      if (currentUrl !== targetUrl) {
        window.history.replaceState(null, "", targetUrl);
      }
    },
    []
  );

  // Fetch links
  const fetchLinks = useCallback(async () => {
    setLoading(true);
    try {
      const query: ListLinksQuery = {
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
        search: search.trim() || undefined,
        tag: tag.trim() || undefined,
        isActive: statusFilter === "active" ? "true" : statusFilter === "inactive" ? "false" : undefined,
        sortBy,
        sortOrder,
      };

      const res = await listLinks(query);
      setLinks(res.data);
      setTotalCount(res.pagination.total);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load links");
    } finally {
      setLoading(false);
    }
  }, [page, search, tag, statusFilter, sortBy, sortOrder]);

  useEffect(() => {
    fetchLinks();
  }, [fetchLinks]);

  // Sync state to URL
  useEffect(() => {
    updateUrlParams({
      search: search.trim(),
      tag: tag.trim(),
      status: statusFilter,
      sortBy,
      sortOrder,
      page,
    });
  }, [search, tag, statusFilter, sortBy, sortOrder, page, updateUrlParams]);

  // Quick shorten submit
  async function handleQuickShorten(e: React.FormEvent) {
    e.preventDefault();
    let target = quickUrl.trim();
    if (!target) return;

    if (!/^https?:\/\//i.test(target)) {
      target = "https://" + target;
    }

    try {
      new URL(target);
    } catch {
      toast.error("Please enter a valid URL");
      return;
    }

    setQuickShortening(true);
    try {
      const created = await createLink({ targetUrl: target });
      toast.success(`Created short link /${created.slug}`);
      setQuickUrl("");
      fetchLinks();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create short link");
    } finally {
      setQuickShortening(false);
    }
  }

  function handleOpenCreateModal() {
    setEditingLink(null);
    setFormModalOpen(true);
  }

  function handleOpenEditModal(link: LinkRecord) {
    setEditingLink(link);
    setFormModalOpen(true);
  }

  function handleOpenQrModal(link: LinkRecord) {
    setQrModalLink(link);
  }

  function handleLinkUpdated(_saved: LinkRecord) {
    fetchLinks();
  }

  function handleLinkDeleted(id: string) {
    setLinks((prev) => prev.filter((l) => l.id !== id));
    setTotalCount((prev) => Math.max(0, prev - 1));
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE) || 1;

  return (
    <div className="space-y-6">
      {/* Quick Shorten Bar */}
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 sm:p-5 shadow-xs">
        <form onSubmit={handleQuickShorten} className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-zinc-400">
              <Link2 className="w-5 h-5" />
            </div>
            <Input
              type="text"
              placeholder="Paste long URL to shorten (e.g. https://example.com/very/long/path)..."
              value={quickUrl}
              onChange={(e) => setQuickUrl(e.target.value)}
              disabled={quickShortening}
              className="pl-11 h-11 text-sm bg-zinc-50 dark:bg-zinc-950 border-zinc-200 dark:border-zinc-800"
            />
          </div>

          <div className="flex gap-2">
            <Button
              type="submit"
              disabled={quickShortening || !quickUrl.trim()}
              className="h-11 px-5 gap-2 text-sm font-semibold"
            >
              {quickShortening ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Shortening...</span>
                </>
              ) : (
                <span>Shorten</span>
              )}
            </Button>

            <Button
              type="button"
              variant="outline"
              onClick={handleOpenCreateModal}
              className="h-11 px-3.5 gap-1.5 text-sm"
              title="Create link with custom slug and advanced settings"
            >
              <Plus className="w-4 h-4" />
              <span className="hidden md:inline">Advanced</span>
            </Button>
          </div>
        </form>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
        {/* Search Input */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400" />
          <Input
            type="text"
            placeholder="Search by slug, URL, title..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="pl-9 pr-8 h-10 text-sm"
          />
          {search && (
            <button
              onClick={() => {
                setSearch("");
                setPage(1);
              }}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Filter dropdowns */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value);
              setPage(1);
            }}
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm shadow-xs dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Only</option>
            <option value="inactive">Inactive Only</option>
          </select>

          {/* Sort By */}
          <select
            value={`${sortBy}:${sortOrder}`}
            onChange={(e) => {
              const [sb, so] = e.target.value.split(":");
              setSortBy(sb as "createdAt" | "updatedAt" | "clickCount" | "slug");
              setSortOrder(so as "asc" | "desc");
              setPage(1);
            }}
            className="h-10 rounded-lg border border-zinc-200 bg-white px-3 text-sm shadow-xs dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
          >
            <option value="createdAt:desc">Newest First</option>
            <option value="createdAt:asc">Oldest First</option>
            <option value="clickCount:desc">Most Clicks</option>
            <option value="slug:asc">Slug (A-Z)</option>
          </select>

          {/* Tag Filter Input / Clear */}
          {tag && (
            <div className="flex items-center gap-1.5 bg-zinc-200 dark:bg-zinc-800 text-sm px-2.5 py-1 rounded-md">
              <span>#{tag}</span>
              <button
                onClick={() => {
                  setTag("");
                  setPage(1);
                }}
                className="hover:text-red-500"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Links List */}
      <div className="space-y-3">
        {loading && links.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3 bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl">
            <Loader2 className="w-6 h-6 animate-spin text-zinc-400" />
            <p className="text-sm text-zinc-400">Loading links...</p>
          </div>
        ) : links.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-4 text-center bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl space-y-3">
            <div className="w-12 h-12 rounded-full bg-zinc-100 dark:bg-zinc-800 flex items-center justify-center text-zinc-400">
              <Link2 className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold">No links found</h3>
            <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-sm">
              {search || tag || statusFilter !== "all"
                ? "No links matched your current filter criteria. Try clearing your filters."
                : "You haven't created any short links yet. Shorten your first link above to get started!"}
            </p>
            {search || tag || statusFilter !== "all" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearch("");
                  setTag("");
                  setStatusFilter("all");
                  setPage(1);
                }}
              >
                Reset Filters
              </Button>
            ) : null}
          </div>
        ) : (
          links.map((link) => (
            <LinkRow
              key={link.id}
              link={link}
              onUpdate={handleLinkUpdated}
              onDelete={handleLinkDeleted}
              onOpenEdit={handleOpenEditModal}
              onOpenQr={handleOpenQrModal}
            />
          ))
        )}
      </div>

      {/* Pagination Footer */}
      {totalCount > PAGE_SIZE && (
        <div className="flex items-center justify-between pt-2">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Showing {(page - 1) * PAGE_SIZE + 1}–
            {Math.min(page * PAGE_SIZE, totalCount)} of {totalCount} links
          </p>

          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="h-8 w-8 p-0"
            >
              <ChevronLeft className="w-4 h-4" />
            </Button>
            <span className="text-xs font-medium px-2">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="h-8 w-8 p-0"
            >
              <ChevronRight className="w-4 h-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Modals */}
      <LinkFormModal
        isOpen={formModalOpen}
        onClose={() => setFormModalOpen(false)}
        onSuccess={handleLinkUpdated}
        initialLink={editingLink}
      />

      {qrModalLink && (
        <QrCodeModal
          isOpen={Boolean(qrModalLink)}
          onClose={() => setQrModalLink(null)}
          slug={qrModalLink.slug}
          targetUrl={qrModalLink.targetUrl}
        />
      )}
    </div>
  );
}
