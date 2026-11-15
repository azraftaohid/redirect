import React, { useCallback, useEffect, useState } from "react";
import type { CreateTokenInput, TokenInfo } from "@redirect/shared";
import { useAuth } from "@/context/AuthContext";
import {
  listTokens,
  createToken,
  deleteToken,
  revokeAllTokens,
  rotateInitialToken,
} from "@/api/client";
import { formatDisplayDate } from "@/utils/dates";
import { exportAndDownloadLinks } from "@/utils/transfer";
import { ImportLinksModal } from "@/components/ImportLinksModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Key,
  Plus,
  RefreshCw,
  Trash2,
  Copy,
  Check,
  Eye,
  EyeOff,
  AlertTriangle,
  ShieldCheck,
  Loader2,
  ShieldAlert,
  Download,
  Upload,
} from "lucide-react";
import { toast } from "sonner";

export function SettingsPage(): React.ReactElement {
  const { token: activeToken, principal, updateActiveToken, logout } = useAuth();

  const [tokens, setTokens] = useState<TokenInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // Stored token reveal
  const [showStoredToken, setShowStoredToken] = useState(false);
  const [copiedStoredToken, setCopiedStoredToken] = useState(false);

  // Create token modal
  const [createModalOpen, setCreateModalOpen] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [tokenExpiresAt, setTokenExpiresAt] = useState("");
  const [creating, setCreating] = useState(false);

  // Revealed token modal (after create or rotate)
  const [revealedToken, setRevealedToken] = useState<string | null>(null);
  const [revealedTitle, setRevealedTitle] = useState("");
  const [copiedRevealedToken, setCopiedRevealedToken] = useState(false);

  // Delete token alert
  const [tokenToDelete, setTokenToDelete] = useState<TokenInfo | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Rotate initial token alert
  const [rotateAlertOpen, setRotateAlertOpen] = useState(false);
  const [rotating, setRotating] = useState(false);

  // Revoke all custom tokens alert
  const [revokeAllAlertOpen, setRevokeAllAlertOpen] = useState(false);
  const [revokingAll, setRevokingAll] = useState(false);

  // Import & Export
  const [exportingLinks, setExportingLinks] = useState(false);
  const [importModalOpen, setImportModalOpen] = useState(false);

  const storedToken = activeToken || "";
  const canManageTokens = principal?.kind === "env" || principal?.kind === "initial";
  const isEnvKeySession = principal?.kind === "env";
  const hasInitialToken = tokens.some((t) => t.isInitial);
  const customTokenCount = tokens.filter((t) => !t.isInitial).length;
  const minExpiry = new Date(Date.now() + 120_000).toISOString().slice(0, 16);

  const fetchTokens = useCallback(async () => {
    if (!canManageTokens) {
      setTokens([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await listTokens();
      setTokens(res.data);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load tokens");
    } finally {
      setLoading(false);
    }
  }, [canManageTokens]);

  useEffect(() => {
    fetchTokens();
  }, [fetchTokens]);

  async function handleCopyStoredToken() {
    if (!storedToken) return;
    try {
      await navigator.clipboard.writeText(storedToken);
      setCopiedStoredToken(true);
      toast.success("Token copied to clipboard");
      setTimeout(() => setCopiedStoredToken(false), 2000);
    } catch {
      toast.error("Failed to copy token");
    }
  }

  async function handleCreateToken(e: React.FormEvent) {
    e.preventDefault();
    if (!tokenName.trim()) {
      toast.error("Token name is required");
      return;
    }

    setCreating(true);
    try {
      const input: CreateTokenInput = {
        name: tokenName.trim(),
        expiresAt: tokenExpiresAt ? new Date(tokenExpiresAt).toISOString() : null,
      };
      const res = await createToken(input);
      setCreateModalOpen(false);
      setTokenName("");
      setTokenExpiresAt("");
      setRevealedTitle(`New Token Created: ${res.name}`);
      setRevealedToken(res.token);
      toast.success("Token created successfully");
      fetchTokens();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create token");
    } finally {
      setCreating(false);
    }
  }

  async function handleConfirmDelete() {
    if (!tokenToDelete) return;
    setDeleting(true);

    const isCurrentActive =
      (principal?.kind === "token" && principal?.id === tokenToDelete.id) ||
      (principal?.kind === "initial" && tokenToDelete.isInitial);

    try {
      await deleteToken(tokenToDelete.id);
      toast.success(`Deleted token "${tokenToDelete.name}"`);
      setTokenToDelete(null);

      if (isCurrentActive) {
        toast.info("Active token was revoked. Logging out...");
        logout();
      } else {
        fetchTokens();
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete token");
    } finally {
      setDeleting(false);
    }
  }

  async function handleConfirmRotateInitial() {
    setRotating(true);
    try {
      const res = await rotateInitialToken();
      setRotateAlertOpen(false);

      // If user was using the initial token, update it seamlessly
      if (principal?.kind === "initial") {
        updateActiveToken(res.token);
        toast.success("Rotated initial token and updated your active session!");
      } else {
        toast.success("Rotated initial token successfully!");
      }

      setRevealedTitle("Initial Token Rotated");
      setRevealedToken(res.token);
      fetchTokens();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to rotate initial token");
    } finally {
      setRotating(false);
    }
  }

  async function handleConfirmRevokeAll() {
    setRevokingAll(true);
    try {
      const res = await revokeAllTokens();
      setRevokeAllAlertOpen(false);
      if (res.truncated) {
        toast.warning(
          `Revoked ${res.count} custom token(s). More tokens remain — click "Revoke All Custom" again to continue.`,
        );
      } else {
        toast.success(`Revoked ${res.count} custom token(s).`);
      }
      fetchTokens();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke custom tokens");
    } finally {
      setRevokingAll(false);
    }
  }

  async function handleCopyRevealed() {
    if (!revealedToken) return;
    try {
      await navigator.clipboard.writeText(revealedToken);
      setCopiedRevealedToken(true);
      toast.success("Token copied to clipboard");
      setTimeout(() => setCopiedRevealedToken(false), 2000);
    } catch {
      toast.error("Failed to copy token");
    }
  }

  async function handleExportAllLinks() {
    if (exportingLinks) return;
    setExportingLinks(true);
    try {
      const envelope = await exportAndDownloadLinks();
      toast.success(`Exported ${envelope.count} link(s) to JSON`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to export links");
    } finally {
      setExportingLinks(false);
    }
  }

  const isCurrentTokenDeleting =
    tokenToDelete &&
    ((principal?.kind === "token" && principal?.id === tokenToDelete.id) ||
      (principal?.kind === "initial" && tokenToDelete.isInitial));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">API Tokens &amp; Access</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
          Manage bearer tokens for REST API access and dashboard authentication.
        </p>
      </div>

      {/* Current Session Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center justify-between">
            <span className="flex items-center gap-2">
              <Key className="w-4 h-4 text-zinc-500" />
              <span>Current Session</span>
            </span>
            {principal?.kind === "env" ? (
              <Badge variant="secondary" className="gap-1 font-mono text-xs">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                <span>Master Secret (API_KEY)</span>
              </Badge>
            ) : principal?.kind === "initial" ? (
              <Badge variant="outline" className="text-xs font-mono text-amber-600 border-amber-300">
                Initial Token
              </Badge>
            ) : (
              <Badge variant="secondary" className="text-xs font-mono">
                {principal?.name}
              </Badge>
            )}
          </CardTitle>
          <CardDescription className="text-sm">
            The bearer token currently stored in this browser for authenticating API requests.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-2 bg-zinc-50 dark:bg-zinc-950 p-2.5 rounded-lg border border-zinc-200 dark:border-zinc-800">
            <div className="flex-1 font-mono text-sm truncate">
              {showStoredToken
                ? storedToken || "No token stored"
                : storedToken
                ? storedToken.slice(0, 8) + "••••••••••••••••••••••••••••••••" + storedToken.slice(-4)
                : "No token stored"}
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => setShowStoredToken(!showStoredToken)}
              className="h-7 w-7 text-zinc-400 hover:text-zinc-600"
              title={showStoredToken ? "Hide token" : "Show full token"}
            >
              {showStoredToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={handleCopyStoredToken}
              disabled={!storedToken}
              className="h-7 w-7 text-zinc-400 hover:text-zinc-600"
              title="Copy active token"
            >
              {copiedStoredToken ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Tokens List Card */}
      <Card>
        <CardHeader className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-3">
          <div>
            <CardTitle className="text-base">Active API Tokens</CardTitle>
            <CardDescription>
              Bearer tokens authorized to access the Redirect REST API.
            </CardDescription>
          </div>
          {canManageTokens && (
            <div className="flex flex-wrap items-center gap-2">
              {customTokenCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRevokeAllAlertOpen(true)}
                  className="h-8 gap-1.5 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40"
                  title="Revoke all custom tokens"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Revoke All Custom</span>
                </Button>
              )}

              {hasInitialToken && !isEnvKeySession && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRotateAlertOpen(true)}
                  className="h-8 gap-1.5 text-xs"
                  title="Rotate initial token in KV"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  <span>Rotate Initial</span>
                </Button>
              )}

              {!isEnvKeySession && (
                <Button
                  size="sm"
                  onClick={() => setCreateModalOpen(true)}
                  className="h-8 gap-1.5 text-xs font-semibold"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Create Token</span>
                </Button>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent>
          {!canManageTokens ? (
            <div className="rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-4 text-xs text-zinc-600 dark:text-zinc-400 flex items-start gap-2.5">
              <ShieldAlert className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
              <p>
                Token management is restricted to sessions authenticated with the initial token or master{" "}
                <code className="font-mono">API_KEY</code>. Custom tokens can manage links and analytics, but cannot view, create, rotate, or revoke API tokens.
              </p>
            </div>
          ) : loading ? (
            <div className="flex items-center justify-center py-12 gap-2 text-xs text-zinc-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Loading tokens...</span>
            </div>
          ) : (
            <>
              {isEnvKeySession && (
                <div className="mb-4 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2.5">
                  <ShieldAlert className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <p>
                    <span className="font-medium">
                      Strict lockdown mode (<code className="font-mono">API_KEY</code> set):
                    </span>{" "}
                    KV-backed custom tokens and the initial token cannot authenticate while master{" "}
                    <code className="font-mono">API_KEY</code> is configured. Creating new tokens and rotating the initial token are disabled; you can still revoke any leftover KV tokens below.
                  </p>
                </div>
              )}

              {tokens.length === 0 ? (
                <div className="text-center py-12 text-xs text-zinc-400">
                  No custom tokens created yet.
                </div>
              ) : (
                <div className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {tokens.map((t) => {
                    const isCurrent =
                      (principal?.kind === "token" && principal?.id === t.id) ||
                      (principal?.kind === "initial" && t.isInitial);

                    return (
                      <div
                        key={t.id}
                        className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-base">{t.name}</span>
                            {t.isInitial && (
                              <Badge variant="outline" className="text-xs py-0.5 px-2 text-amber-600 border-amber-300">
                                Initial
                              </Badge>
                            )}
                            {isCurrent && (
                              <Badge variant="secondary" className="text-xs py-0.5 px-2">
                                Active Session
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400 font-mono">
                            <span>Preview: {t.preview}</span>
                            <span>&bull;</span>
                            <span>Created: {formatDisplayDate(t.createdAt)}</span>
                            {t.expiresAt && (
                              <>
                                <span>&bull;</span>
                                <span>Expires: {formatDisplayDate(t.expiresAt)}</span>
                              </>
                            )}
                          </div>
                        </div>

                        {t.isInitial ? (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => setRotateAlertOpen(true)}
                            className="h-8 px-2.5 text-sm gap-1.5 self-end sm:self-center"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>Rotate</span>
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setTokenToDelete(t)}
                            className="text-red-600 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/40 h-8 px-2.5 text-sm gap-1.5 self-end sm:self-center"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Revoke</span>
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Data Portability Card */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Data Portability (Import &amp; Export)</CardTitle>
          <CardDescription>
            Export all short links and metadata as versioned JSON (excluding analytics and API tokens), or import links from a JSON or CSV file.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleExportAllLinks}
            disabled={exportingLinks}
            className="h-9 gap-1.5 text-sm"
          >
            {exportingLinks ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Download className="w-4 h-4" />
            )}
            <span>{exportingLinks ? "Exporting..." : "Export All Links (JSON)"}</span>
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setImportModalOpen(true)}
            className="h-9 gap-1.5 text-sm"
          >
            <Upload className="w-4 h-4" />
            <span>Import Links (JSON / CSV)</span>
          </Button>
        </CardContent>
      </Card>

      {/* Create Token Modal */}
      <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create API Token</DialogTitle>
            <DialogDescription>
              Create a new bearer token with optional expiration.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateToken} className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="token-name">Token Name <span className="text-red-500">*</span></Label>
              <Input
                id="token-name"
                type="text"
                placeholder="e.g. CLI Deployer, Mobile Shortcut"
                value={tokenName}
                onChange={(e) => setTokenName(e.target.value)}
                maxLength={64}
                disabled={creating}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="token-expires">Expiration Date <span className="text-zinc-400 font-normal">(optional)</span></Label>
              <Input
                id="token-expires"
                type="datetime-local"
                min={minExpiry}
                value={tokenExpiresAt}
                onChange={(e) => setTokenExpiresAt(e.target.value)}
                disabled={creating}
                className="text-xs"
              />
            </div>

            <DialogFooter className="pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setCreateModalOpen(false)}
                disabled={creating}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={creating || !tokenName.trim()}>
                {creating ? "Creating..." : "Create Token"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Revealed Token Modal */}
      <Dialog open={Boolean(revealedToken)} onOpenChange={() => setRevealedToken(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Key className="w-5 h-5 text-emerald-600" />
              <span>{revealedTitle || "Token Secret"}</span>
            </DialogTitle>
            <DialogDescription>
              Copy this token now. It is also visible as the value of `token:&lt;id&gt;` (or `initial_token`) in your Cloudflare KV dashboard. For security, you will not be able to see it again here.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 pt-2">
            <div className="p-3 bg-zinc-900 text-zinc-50 dark:bg-zinc-950 dark:text-zinc-50 rounded-lg font-mono text-xs break-all select-all border border-zinc-800">
              {revealedToken}
            </div>

            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-amber-800 dark:text-amber-300 text-xs">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              <span>
                Store this token securely in your password manager or environment secrets.
              </span>
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              onClick={handleCopyRevealed}
              className="w-full gap-2 font-semibold"
            >
              {copiedRevealedToken ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              <span>{copiedRevealedToken ? "Copied to Clipboard" : "Copy Token"}</span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revoke Token Alert */}
      <AlertDialog open={Boolean(tokenToDelete)} onOpenChange={(open) => !open && setTokenToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              {isCurrentTokenDeleting && <ShieldAlert className="w-5 h-5 text-red-600" />}
              <span>Revoke Token "{tokenToDelete?.name}"?</span>
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                Are you sure you want to revoke this API token? Any automated scripts or integrations using this token will immediately fail.
              </p>
              {isCurrentTokenDeleting && (
                <span className="block p-2.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-red-800 dark:text-red-300 text-xs font-semibold">
                  WARNING: This is your currently active session token! Revoking it will immediately log you out and return you to the unlock screen.
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleConfirmDelete();
              }}
              disabled={deleting}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {deleting ? "Revoking..." : "Revoke Token"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rotate Initial Token Alert */}
      <AlertDialog open={rotateAlertOpen} onOpenChange={setRotateAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Rotate Initial Token?</AlertDialogTitle>
            <AlertDialogDescription>
              This will generate a brand new cryptographically secure token and replace the auto-generated initial token in Cloudflare KV. If your active browser session is using the initial token, your session will be automatically updated with the new token.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rotating}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleConfirmRotateInitial();
              }}
              disabled={rotating}
            >
              {rotating ? "Rotating..." : "Rotate & Reveal New Token"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Revoke All Custom Tokens Alert */}
      <AlertDialog open={revokeAllAlertOpen} onOpenChange={setRevokeAllAlertOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke All Custom Tokens?</AlertDialogTitle>
            <AlertDialogDescription>
              This will immediately delete all {customTokenCount} custom API token(s) from Cloudflare KV. Any integrations or scripts using them will lose access immediately. The initial token and master API_KEY (if set) are not affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revokingAll}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleConfirmRevokeAll();
              }}
              disabled={revokingAll}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              {revokingAll ? "Revoking..." : "Revoke All Custom Tokens"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Import Links Modal */}
      <ImportLinksModal
        isOpen={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        onSuccess={() => {}}
      />
    </div>
  );
}
