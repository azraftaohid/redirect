import React, { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Link2,
  Settings,
  Share2,
  LogOut,
  ShieldCheck,
} from "lucide-react";
import { AppLogo } from "@/components/AppLogo";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps): React.ReactElement {
  const [location] = useLocation();
  const { principal, logout } = useAuth();

  // Reset scroll to top on any route navigation
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [location]);

  const navItems = [
    { href: "/", label: "Links", icon: Link2, exact: true },
    { href: "/share", label: "Share", icon: Share2 },
    { href: "/settings", label: "Settings", icon: Settings },
  ];

  const isActive = (href: string, exact?: boolean) => {
    if (exact) return location === href || (href === "/" && (location === "" || location === "/"));
    return location.startsWith(href);
  };

  const getPrincipalBadge = () => {
    if (!principal) return null;
    switch (principal.kind) {
      case "env":
        return (
          <Badge variant="secondary" className="gap-1 font-mono text-xs py-0.5 px-2">
            <ShieldCheck className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
            <span>Master Key (Env)</span>
          </Badge>
        );
      case "initial":
        return (
          <Badge variant="outline" className="gap-1 font-mono text-xs py-0.5 px-2 text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-800">
            <span>Initial Token</span>
          </Badge>
        );
      case "token":
        return (
          <Badge variant="secondary" className="gap-1 font-mono text-xs py-0.5 px-2 truncate max-w-[160px]">
            <span>{principal.name}</span>
          </Badge>
        );
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-zinc-50 dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
      {/* Top Header */}
      <header className="sticky top-0 z-40 w-full border-b border-zinc-200 dark:border-zinc-800 bg-white/80 dark:bg-zinc-900/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          {/* Logo & Desktop Nav */}
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 font-bold text-base tracking-tight hover:opacity-85 transition-opacity">
              <AppLogo className="w-7 h-7" />
              <span>Redirect</span>
            </Link>

            <nav className="hidden sm:flex items-center gap-1">
              {navItems.map((item) => {
                const active = isActive(item.href, item.exact);
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors",
                      active
                        ? "bg-zinc-100 dark:bg-zinc-800 text-zinc-950 dark:text-zinc-50"
                        : "text-zinc-600 dark:text-zinc-400 hover:text-zinc-950 dark:hover:text-zinc-50 hover:bg-zinc-100/50 dark:hover:bg-zinc-800/50"
                    )}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </Link>
                );
              })}
            </nav>
          </div>

          {/* Right Principal & Actions */}
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center">
              {getPrincipalBadge()}
            </div>

            <Button
              variant="ghost"
              size="sm"
              onClick={logout}
              title="Lock / Sign out"
              className="text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100 h-8 px-2.5 gap-1.5 text-xs"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Lock</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6 pb-20 sm:pb-6">
        {children}
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-zinc-200 dark:border-zinc-800 bg-white/95 dark:bg-zinc-900/95 backdrop-blur-md safe-pb">
        <div className="grid grid-cols-3 h-14">
          {navItems.map((item) => {
            const active = isActive(item.href, item.exact);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 text-xs font-medium transition-colors",
                  active
                    ? "text-zinc-950 dark:text-zinc-50 font-semibold"
                    : "text-zinc-500 dark:text-zinc-400"
                )}
              >
                <Icon className={cn("w-4 h-4", active && "scale-110 transition-transform")} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
