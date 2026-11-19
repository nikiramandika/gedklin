import type { ReactNode } from "react";

import { BrandMark } from "./icons";

// Cincin tabung mesin cuci dari BrandMark, dibesarkan samar di pita navy. Murni hiasan.
export function DrumRings({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 400"
      aria-hidden="true"
      focusable="false"
      className={`pointer-events-none absolute select-none ${className}`}
      fill="none"
    >
      <circle cx="200" cy="200" r="196" stroke="#cdd4e7" strokeOpacity=".07" strokeWidth="2" />
      <circle cx="200" cy="200" r="150" stroke="#cdd4e7" strokeOpacity=".09" strokeWidth="18" />
      <circle cx="200" cy="200" r="104" stroke="#8e9dd2" strokeOpacity=".14" strokeWidth="2" />
      <path
        d="M128 214c24-22 48-22 72 0s48 22 72 0"
        stroke="#8e9dd2"
        strokeOpacity=".22"
        strokeWidth="6"
        strokeLinecap="round"
      />
      <circle cx="64" cy="40" r="7" fill="#cdd4e7" fillOpacity=".12" />
      <circle cx="90" cy="40" r="7" fill="#cdd4e7" fillOpacity=".07" />
    </svg>
  );
}

export function BrandLockup({ size = 36, sub = "Medan" }: { size?: number; sub?: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <BrandMark size={size} className="rounded-[5px] ring-1 ring-white/15" />
      <div className="leading-tight">
        <p className="text-base font-semibold text-white">Gedklin Laundry</p>
        {sub && <p className="text-xs text-nav-faint">{sub}</p>}
      </div>
    </div>
  );
}
