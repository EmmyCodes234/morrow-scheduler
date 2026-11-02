"use client";

import React from "react";
import { cx } from "@/utils/cx";

export interface MorrowLogoProps extends React.SVGProps<SVGSVGElement> {
  size?: number | string;
  variant?: "full" | "icon" | "wordmark";
  color?: string;
  showBadge?: boolean;
}

/**
 * Morrow Icon Mark:
 * A precision geometric mark combining the letter 'M' with an ascending horizon curve,
 * representing scheduling future time ("Tomorrow starts here").
 */
export function MorrowIcon({
  size = 32,
  className,
  showBadge = true,
  ...props
}: {
  size?: number | string;
  className?: string;
  showBadge?: boolean;
} & React.SVGProps<SVGSVGElement>) {
  if (!showBadge) {
    // Pure vector glyph without background tile
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 32 32"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cx("shrink-0", className)}
        {...props}
      >
        <path
          d="M5 25V9C5 7.89543 5.89543 7 7 7C8.10457 7 9 7.89543 9 9V20.5L14.4142 15.0858C15.1953 14.3047 16.4607 14.3047 17.2418 15.0858L22.656 20.5V9C22.656 7.89543 23.5514 7 24.656 7C25.7605 7 26.656 7.89543 26.656 9V25C26.656 25.5523 26.2083 26 25.656 26C25.1037 26 24.656 25.5523 24.656 25V23.5L16.5 15.344L8.344 23.5V25C8.344 25.5523 7.89629 26 7.344 26C6.79171 26 5 25.5523 5 25Z"
          fill="currentColor"
        />
        <circle cx="16" cy="9.5" r="2.5" fill="currentColor" />
      </svg>
    );
  }

  // Polished App Tile Badge
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cx("shrink-0 shadow-2xs rounded-xl", className)}
      {...props}
    >
      <defs>
        <linearGradient id="morrowGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#2563EB" />
          <stop offset="100%" stopColor="#1D4ED8" />
        </linearGradient>
      </defs>
      {/* Tile Container */}
      <rect width="32" height="32" rx="9" fill="url(#morrowGrad)" />
      
      {/* Inner geometric 'M' mark with clock/horizon motif */}
      <path
        d="M7.5 22.5V11C7.5 10.1716 8.17157 9.5 9 9.5C9.82843 9.5 10.5 10.1716 10.5 11V18.2L14.7929 13.9071C15.4595 13.2405 16.5405 13.2405 17.2071 13.9071L21.5 18.2V11C21.5 10.1716 22.1716 9.5 23 9.5C23.8284 9.5 24.5 10.1716 24.5 11V22.5C24.5 23.0523 24.0523 23.5 23.5 23.5C22.9477 23.5 22.5 23.0523 22.5 22.5V20.5L16.7071 14.7071C16.3166 14.3166 15.6834 14.3166 15.2929 14.7071L9.5 20.5V22.5C9.5 23.0523 9.05228 23.5 8.5 23.5C7.94772 23.5 7.5 23.0523 7.5 22.5Z"
        fill="#FFFFFF"
      />
      {/* Ascending focus apex (sunrise/meeting prompt) */}
      <circle cx="16" cy="9.5" r="1.8" fill="#FFFFFF" fillOpacity="0.95" />
    </svg>
  );
}

/**
 * Morrow Typographic Wordmark:
 * Precision geometric letterforms matching Inter sans-serif with optical balance.
 */
export function MorrowWordmark({
  height = 20,
  className,
  fill = "currentColor",
  ...props
}: {
  height?: number | string;
  className?: string;
  fill?: string;
} & React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      height={height}
      viewBox="0 0 110 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cx("shrink-0", className)}
      {...props}
    >
      <text
        x="0"
        y="19"
        fill={fill}
        fontFamily="Inter, system-ui, -apple-system, sans-serif"
        fontSize="21"
        fontWeight="700"
        letterSpacing="-0.04em"
      >
        Morrow
      </text>
      {/* Brand accent dot */}
      <circle cx="104" cy="18" r="2.2" fill="#2563EB" />
    </svg>
  );
}

/**
 * Combined Brand Logo (Icon + Wordmark)
 */
export function MorrowLogo({
  size = 32,
  variant = "full",
  className,
  showBadge = true,
}: MorrowLogoProps) {
  if (variant === "icon") {
    return <MorrowIcon size={size} showBadge={showBadge} className={className} />;
  }

  if (variant === "wordmark") {
    return <MorrowWordmark height={typeof size === "number" ? size * 0.65 : size} className={className} />;
  }

  return (
    <div className={cx("inline-flex items-center gap-2.5 select-none", className)}>
      <MorrowIcon size={size} showBadge={showBadge} />
      <MorrowWordmark height={typeof size === "number" ? size * 0.65 : 20} className="text-text-primary" />
    </div>
  );
}
