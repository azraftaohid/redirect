import React from "react";
import { cn } from "@/lib/utils";

interface AppLogoProps {
  className?: string;
}

/**
 * Brand mark for Redirect: a rounded squircle housing a bold `/>` glyph.
 */
export function AppLogo({ className }: AppLogoProps): React.ReactElement {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 100 100"
      fill="none"
      aria-hidden="true"
      className={cn("shrink-0", className)}
    >
      <rect
        width="100"
        height="100"
        rx="24"
        className="fill-zinc-900 dark:fill-zinc-100"
      />
      <path
        d="M43.5 24L26.5 76"
        className="stroke-zinc-50 dark:stroke-zinc-950"
        strokeWidth="8.7"
        strokeLinecap="round"
      />
      <path
        d="M55.5 34L74.5 50L55.5 66"
        className="stroke-zinc-50 dark:stroke-zinc-950"
        strokeWidth="8.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
