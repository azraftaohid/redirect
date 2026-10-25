import React from "react";
import { useAuth } from "@/context/AuthContext";
import { AlertCircle, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AccessExpiredBanner(): React.ReactElement | null {
  const { accessExpired, clearAccessExpired } = useAuth();

  if (!accessExpired) return null;

  function handleReload() {
    window.location.reload();
  }

  return (
    <div className="bg-amber-500 text-zinc-950 px-4 py-2.5 text-sm font-medium shadow-md sticky top-0 z-50 transition-all flex items-center justify-between gap-4">
      <div className="flex items-center gap-2.5 min-w-0">
        <AlertCircle className="w-5 h-5 shrink-0" />
        <span className="truncate" title="Your session may have expired or the server is unreachable. Reload the page to reconnect or sign back in.">
          Your session may have expired or the server is unreachable. Reload the page to reconnect or sign back in.
        </span>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <Button
          size="sm"
          variant="outline"
          onClick={handleReload}
          className="bg-white text-zinc-950 hover:bg-zinc-100 border-none shadow-xs text-xs font-semibold h-7 px-2.5 gap-1.5"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Reload</span>
        </Button>
        <button
          onClick={clearAccessExpired}
          className="p-1 rounded-md hover:bg-amber-600/30 text-zinc-950 transition-colors"
          aria-label="Dismiss banner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
