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
// ponytail: LazyLoader 的 props 透传语义要求接受任意具体组件（AppShell 等
// 传入具名 props 的 LazyExoticComponent），这里故意用 `any` 保留兼容。
// 收紧到 Record<string, unknown> 会让调用方（AppShell.tsx 1751 等）类型报错。
/* eslint-disable @typescript-eslint/no-explicit-any */
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
