import React, { useState } from "react";
import { Link } from "wouter";
import type { LinkRecord } from "@redirect/shared";
import { updateLink, deleteLink } from "@/api/client";
import { isLinkExpired, formatDisplayDate } from "@/utils/dates";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Copy,
  Check,
  ExternalLink,
  MoreVertical,
  BarChart2,
  QrCode,
  Edit,
  Trash2,
  Clock,
} from "lucide-react";
import { toast } from "sonner";

interface LinkRowProps {
  link: LinkRecord;
  onUpdate: (updated: LinkRecord) => void;
  onDelete: (id: string) => void;
  onOpenEdit: (link: LinkRecord) => void;
  onOpenQr: (link: LinkRecord) => void;
}

export function LinkRow({
  link,
  onUpdate,
  onDelete,
  onOpenEdit,
  onOpenQr,
}: LinkRowProps): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const [isUpdatingActive, setIsUpdatingActive] = useState(false);
  const [showDeleteAlert, setShowDeleteAlert] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const fullShortUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/${link.slug}`
      : `/${link.slug}`;

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(fullShortUrl);
      setCopied(true);
      toast.success(`Copied /${link.slug} to clipboard`);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy to clipboard");
    }
  }

  async function handleToggleActive(checked: boolean) {
    if (isUpdatingActive) return;

    // Optimistic update
    const previous = link.isActive;
    onUpdate({ ...link, isActive: checked });
    setIsUpdatingActive(true);

    try {
      const result = await updateLink(link.id, { isActive: checked });
      onUpdate(result);
      toast.success(`Link is now ${checked ? "active" : "inactive"}`);
    } catch (err) {
      // Rollback
      onUpdate({ ...link, isActive: previous });
      toast.error(err instanceof Error ? err.message : "Failed to toggle link status");
    } finally {
      setIsUpdatingActive(false);
    }
  }

  async function handleDeleteConfirm() {
    setIsDeleting(true);
    try {
      await deleteLink(link.id);
      toast.success(`Deleted link /${link.slug}`);
      onDelete(link.id);
      setShowDeleteAlert(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete link");
    } finally {
      setIsDeleting(false);
    }
  }

  const expired = isLinkExpired(link.expiresAt);

  return (
    <>
      <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-4 transition-all hover:border-zinc-300 dark:hover:border-zinc-700 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Left Column: Slug, Title & Destination */}
          <div className="min-w-0 flex-1 space-y-1">
            {/* Slug row */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-mono text-base font-bold text-zinc-950 dark:text-zinc-50 tracking-tight">
                /{link.slug}
              </span>

              <button
                type="button"
                onClick={handleCopy}
                className="p-1 rounded-md text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
                title="Copy short link"
                aria-label="Copy short link"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
              </button>

              {/* Status Badges */}
              {expired ? (
                <Badge variant="destructive" className="text-[10px] py-0 px-1.5">
                  Expired
                </Badge>
              ) : link.isActive ? (
                <Badge variant="success" className="text-[10px] py-0 px-1.5">
                  Active
                </Badge>
              ) : (
                <Badge variant="secondary" className="text-[10px] py-0 px-1.5">
                  Inactive
                </Badge>
              )}

              <Badge variant="outline" className="text-[10px] py-0 px-1.5 font-mono">
                {link.statusCode}
              </Badge>

              {link.forwardQuery && (
                <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-blue-600 border-blue-300 dark:text-blue-400 dark:border-blue-800">
                  +query
                </Badge>
              )}
            </div>

            {/* Target URL & Title */}
            <div className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
              {link.title && (
                <span className="font-medium text-zinc-700 dark:text-zinc-300 mr-1 truncate max-w-xs">
                  {link.title} &bull;
                </span>
              )}
              <a
                href={link.targetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate hover:underline hover:text-zinc-800 dark:hover:text-zinc-200 max-w-sm sm:max-w-md md:max-w-lg"
                title={link.targetUrl}
              >
                {link.targetUrl}
              </a>
              <ExternalLink className="w-3 h-3 shrink-0" />
            </div>

            {/* Tags */}
            {link.tags && link.tags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                {link.tags.map((t) => (
                  <span
                    key={t}
                    className="px-1.5 py-0.2 rounded bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-300 text-[10px] font-medium"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            )}

            {/* Expiration Info */}
            {link.expiresAt && (
              <div className="flex items-center gap-3 text-[11px] text-zinc-400 pt-0.5">
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  Expires: {formatDisplayDate(link.expiresAt)}
                </span>
              </div>
            )}
          </div>

          {/* Right Column: Active Switch, Stats Pill & Dropdown */}
          <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-zinc-100 dark:border-zinc-800">
            {/* Active Toggle */}
            <div className="flex items-center gap-2">
              <Switch
                checked={link.isActive}
                onCheckedChange={handleToggleActive}
                disabled={isUpdatingActive}
                aria-label={`Toggle active status for /${link.slug}`}
              />
            </div>

            {/* Stats Pill Link */}
            <Link href={`/links/${link.id}`}>
              <Button
                variant="outline"
                size="sm"
                className="h-8 gap-1.5 text-xs font-semibold px-2.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                title="View link analytics"
              >
                <BarChart2 className="w-3.5 h-3.5 text-zinc-500" />
                <span>{link.clickCount.toLocaleString()} clicks</span>
              </Button>
            </Link>

            {/* Actions Dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <MoreVertical className="w-4 h-4" />
                  <span className="sr-only">Actions</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem asChild>
                  <Link href={`/links/${link.id}`} className="flex items-center gap-2 w-full">
                    <BarChart2 className="w-4 h-4" />
                    <span>View Stats</span>
                  </Link>
                </DropdownMenuItem>

                <DropdownMenuItem onClick={() => onOpenQr(link)}>
                  <QrCode className="w-4 h-4" />
                  <span>QR Code</span>
                </DropdownMenuItem>

                <DropdownMenuItem onClick={() => onOpenEdit(link)}>
                  <Edit className="w-4 h-4" />
                  <span>Edit</span>
                </DropdownMenuItem>

                <DropdownMenuSeparator />

                <DropdownMenuItem
                  onClick={() => setShowDeleteAlert(true)}
                  className="text-red-600 dark:text-red-400 focus:text-red-600"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Delete</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      {/* Delete Confirmation Alert */}
      <AlertDialog open={showDeleteAlert} onOpenChange={setShowDeleteAlert}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Link /{link.slug}?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to permanently delete this link? Visitors trying to access <code>/{link.slug}</code> will receive a 404 Not Found error. All analytics records for this link will also be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleDeleteConfirm();
              }}
              disabled={isDeleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {isDeleting ? "Deleting..." : "Delete Permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
