import React from "react";
import { Link } from "wouter";
import { useBrandingExternalLinks } from "@/context/AuthContext";
import { AppLogo } from "@/components/AppLogo";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Unlink, ArrowLeft, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

const REPO_URL = "https://github.com/azraftaohid/redirect";

interface NotFoundCardProps {
  title?: string;
  description?: string;
  className?: string;
}

/**
 * Shared 404 card used by the fallback route and missing-entity states.
 */
export function NotFoundCard({
  title = "Page Not Found",
  description = "The page you are looking for does not exist in the Redirect dashboard.",
  className,
}: NotFoundCardProps): React.ReactElement {
  return (
    <Card className={cn("w-full max-w-md mx-auto shadow-xs", className)}>
      <CardContent className="flex flex-col items-center text-center p-6 sm:p-8 space-y-4">
        <div className="w-12 h-12 rounded-xl bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700/80 flex items-center justify-center text-zinc-600 dark:text-zinc-400">
          <Unlink className="w-6 h-6" aria-hidden="true" />
        </div>
        <Badge
          variant="outline"
          className="font-mono text-xs bg-zinc-100 dark:bg-zinc-800/80 text-zinc-600 dark:text-zinc-400"
        >
          404 Not Found
        </Badge>
        <h1 className="text-xl font-bold tracking-tight text-zinc-950 dark:text-zinc-50">
          {title}
        </h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-xs leading-relaxed">
          {description}
        </p>
        <Link href="/">
          <Button size="sm" className="gap-2 mt-1">
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Links</span>
          </Button>
        </Link>
      </CardContent>
    </Card>
  );
}

export function NotFoundPage(): React.ReactElement {
  const brandingExternalLinks = useBrandingExternalLinks();

  return (
    <div className="my-8 sm:my-12 flex flex-col items-center gap-6">
      <NotFoundCard />
      {brandingExternalLinks && (
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-sm font-semibold tracking-tight text-zinc-500 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-950 dark:focus-visible:ring-zinc-300"
        >
          <AppLogo className="w-5 h-5" />
          <span>Redirect</span>
          <span className="font-normal opacity-60" aria-hidden="true">
            &middot;
          </span>
          <span className="font-medium">GitHub</span>
          <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        </a>
      )}
    </div>
  );
}
