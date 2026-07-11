"use client";

import { forwardRef } from "react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Top-bar panel toggle button (phase 7/8).
 *
 * Replaces the ~18-prop inline-style + identical hover-handler blocks that
 * were copy-pasted across 5 buttons in AppShell's top bar. Styling lives in
 * globals.css under `.topbar-panel-btn` (with an `[aria-pressed]` active
 * variant), so React doesn't rebuild the style object each render and the
 * hover state is handled in CSS instead of JS handlers.
 *
 * Pass `active` to render the pressed/active look (sets aria-pressed).
 */
export interface TopBarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  children: ReactNode;
}

export const TopBarButton = forwardRef<HTMLButtonElement, TopBarButtonProps>(function TopBarButton(
  { active = false, className, children, ...rest },
  ref,
) {
  return (
    <button
      {...rest}
      ref={ref}
      aria-pressed={active}
      className={className ? `topbar-panel-btn ${className}` : "topbar-panel-btn"}
    >
      {children}
    </button>
  );
});
