import React from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Home } from "lucide-react";

export function NotFoundPage(): React.ReactElement {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
      <div className="text-6xl font-black text-zinc-300 dark:text-zinc-700">404</div>
      <h2 className="text-xl font-bold tracking-tight">Page Not Found</h2>
      <p className="text-sm text-zinc-500 dark:text-zinc-400 max-w-sm">
        The page you are looking for does not exist in the Redirect dashboard.
      </p>
      <Link href="/">
        <Button size="sm" className="gap-2">
          <Home className="w-4 h-4" />
          <span>Back to Links</span>
        </Button>
      </Link>
    </div>
  );
}
