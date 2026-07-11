"use client";

import { Suspense, type ComponentType, type LazyExoticComponent, type ReactNode } from "react";
import { Skeleton } from "./Skeleton";

/**
 * Wraps a React.lazy component in a <Suspense> boundary with a minimal
 * skeleton fallback, so heavy config panels / file viewers don't block
 * the main thread on first open.
 *
 * Accepts either a plain component or a React.lazy() result. Extra props
 * are forwarded to the wrapped component via the index signature.
 */
export function LazyLoader({
  component: Comp,
  fallback,
  ...rest
}: {
  component: ComponentType<any> | LazyExoticComponent<ComponentType<any>>;
  fallback?: ReactNode;
  [prop: string]: unknown;
}) {
  return (
    <Suspense fallback={fallback ?? <Skeleton width="100%" height={240} radius={8} />}>
      <Comp {...(rest as Record<string, unknown>)} />
    </Suspense>
  );
}
