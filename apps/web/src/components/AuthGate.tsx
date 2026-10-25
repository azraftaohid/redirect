import React, { useState } from "react";
import { useAuth } from "@/context/AuthContext";
import {
  KeyRound,
  Eye,
  EyeOff,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertTriangle,
  Terminal,
  Database,
  Shield,
  LifeBuoy,
  Copy,
  Check,
} from "lucide-react";

export function AuthGate({ children }: { children: React.ReactNode }): React.ReactElement {
  const { status, warning, login } = useAuth();
  const [tokenInput, setTokenInput] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedCmd, setCopiedCmd] = useState(false);

  async function handleCopyCmd() {
    const cmd =
      "pnpm --filter @redirect/api exec wrangler kv key get initial_token --binding AUTH_TOKENS --local";
    try {
      await navigator.clipboard.writeText(cmd);
      setCopiedCmd(true);
      setTimeout(() => setCopiedCmd(false), 2000);
    } catch {
      // Ignore clipboard write errors in restricted contexts
    }
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 p-4">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 animate-spin text-zinc-600 dark:text-zinc-400" />
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">Verifying session...</p>
        </div>
      </div>
    );
  }

  if (status === "authenticated") {
    return <>{children}</>;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!tokenInput.trim()) return;

    setSubmitting(true);
    setErrorMsg(null);

    try {
      await login(tokenInput);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Authentication failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100 p-4">
      <div className="w-full max-w-md">
        {/* Header / Brand */}
        <div className="flex flex-col items-center text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 flex items-center justify-center shadow-md mb-3">
            <KeyRound className="w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Redirect</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400 mt-1">
            Enter your token to access the dashboard
          </p>
        </div>

        {/* Card */}
        <div className="bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 rounded-xl p-6 shadow-sm">
          {warning && (
            <div className="mb-5 flex items-start gap-2.5 p-3.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-amber-800 dark:text-amber-300 text-sm leading-relaxed">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <span>{warning}</span>
            </div>
          )}

          {errorMsg && (
            <div className="mb-5 flex items-start gap-2.5 p-3.5 rounded-lg bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900/60 text-red-800 dark:text-red-300 text-sm leading-relaxed">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600 dark:text-red-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="api-token-input"
                className="block text-xs font-semibold uppercase tracking-wider text-zinc-600 dark:text-zinc-400 mb-1.5"
              >
                Token
              </label>
              <div className="relative">
                <input
                  id="api-token-input"
                  type={showToken ? "text" : "password"}
                  value={tokenInput}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="Paste your token here..."
                  autoComplete="off"
                  spellCheck={false}
                  disabled={submitting}
                  className="w-full pl-3.5 pr-10 py-2.5 text-sm bg-zinc-50 dark:bg-zinc-950 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-zinc-900 dark:focus:ring-zinc-100 disabled:opacity-50 transition-colors font-mono"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  disabled={submitting}
                  tabIndex={-1}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 p-1"
                  aria-label={showToken ? "Hide token" : "Show token"}
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={submitting || !tokenInput.trim()}
              className="w-full flex items-center justify-center gap-2 py-2.5 px-4 text-sm font-semibold rounded-lg bg-zinc-900 dark:bg-zinc-100 text-white dark:text-zinc-900 hover:bg-zinc-800 dark:hover:bg-zinc-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Unlocking...</span>
                </>
              ) : (
                <span>Unlock Dashboard</span>
              )}
            </button>
          </form>

          {/* Help Toggle */}
          <div className="mt-6 pt-5 border-t border-zinc-100 dark:border-zinc-800">
            <button
              type="button"
              onClick={() => setShowHelp(!showHelp)}
              className="w-full flex items-center justify-between text-sm text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors"
            >
              <span className="flex items-center gap-1.5 font-medium">
                <HelpCircle className="w-4 h-4" />
                Where do I find my token?
              </span>
              {showHelp ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showHelp && (
              <div className="mt-4 space-y-3.5 text-sm text-zinc-600 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-950 p-4 rounded-lg border border-zinc-200 dark:border-zinc-800 animate-in fade-in duration-150">
                <div className="flex gap-2.5">
                  <Shield className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-zinc-800 dark:text-zinc-200">1. Worker Secret (API_KEY)</p>
                    <p className="text-xs mt-0.5">
                      If you set the <code className="bg-zinc-200 dark:bg-zinc-800 px-1 py-0.5 rounded font-mono">API_KEY</code> secret in Cloudflare Dashboard (Settings &gt; Variables and Secrets), that value grants admin access.
                    </p>
                  </div>
                </div>

                <div className="flex gap-2.5">
                  <Database className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-zinc-800 dark:text-zinc-200">2. Production Cloudflare KV</p>
                    <p className="text-xs mt-0.5">
                      In Cloudflare Dashboard &gt; Storage &amp; Databases &gt; KV &gt; <code className="bg-zinc-200 dark:bg-zinc-800 px-1 py-0.5 rounded font-mono">AUTH_TOKENS</code>, check the key <code className="bg-zinc-200 dark:bg-zinc-800 px-1 py-0.5 rounded font-mono">initial_token</code> (or any <code className="bg-zinc-200 dark:bg-zinc-800 px-1 py-0.5 rounded font-mono">token:*</code> key) to view its plaintext value.
                    </p>
                  </div>
                </div>

                <div className="flex gap-2.5">
                  <Terminal className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-zinc-800 dark:text-zinc-200">3. Local Dev / CLI</p>
                    <p className="text-xs mt-0.5">
                      In local development or via Wrangler CLI:
                    </p>
                    <div className="relative group mt-1.5">
                      <pre className="p-2.5 pr-8 bg-zinc-200/80 dark:bg-zinc-900 rounded font-mono text-xs overflow-x-auto whitespace-pre-wrap break-all text-zinc-800 dark:text-zinc-300 border border-zinc-300/60 dark:border-zinc-800">
                        pnpm --filter @redirect/api exec wrangler kv key get initial_token --binding AUTH_TOKENS --local
                      </pre>
                      <button
                        type="button"
                        onClick={handleCopyCmd}
                        className="absolute top-2 right-2 p-1 rounded bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-600 dark:text-zinc-300 transition-colors"
                        title={copiedCmd ? "Copied!" : "Copy command"}
                        aria-label="Copy command"
                      >
                        {copiedCmd ? (
                          <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                <div className="flex gap-2.5">
                  <LifeBuoy className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-zinc-800 dark:text-zinc-200">4. Emergency Recovery</p>
                    <p className="text-xs mt-0.5">
                      If locked out, run <code className="bg-zinc-200 dark:bg-zinc-800 px-1 py-0.5 rounded font-mono">wrangler secret put API_KEY</code> to set a master fallback token.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
