import React from "react";

export function GoogleCalendarIcon({ className = "size-5" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="17" rx="3" fill="#ffffff" />
      <path d="M18 4H6C4.34315 4 3 5.34315 3 7V9H21V7C21 5.34315 19.6569 4 18 4Z" fill="#EA4335" />
      <path d="M21 9H19V18C19 19.6569 17.6569 21 16 21H18C19.6569 21 21 19.6569 21 18V9Z" fill="#4285F4" />
      <path d="M5 21H16C17.6569 21 19 19.6569 19 18H5C3.34315 18 2 16.6569 2 15V18C2 19.6569 3.34315 21 5 21Z" fill="#34A853" />
      <path d="M3 7V18C3 19.6569 4.34315 21 6 21H5C3.34315 21 2 19.6569 2 18V9C2 7.34315 3.34315 6 5 6H6C4.34315 6 3 7 3 7Z" fill="#FBBC05" />
      <rect x="7" y="2" width="2" height="4" rx="1" fill="#EA4335" />
      <rect x="15" y="2" width="2" height="4" rx="1" fill="#EA4335" />
      <text
        x="12"
        y="16.5"
        textAnchor="middle"
        fontSize="7.5"
        fontWeight="700"
        fill="#1A73E8"
        fontFamily="system-ui, -apple-system, sans-serif"
      >
        31
      </text>
    </svg>
  );
}
