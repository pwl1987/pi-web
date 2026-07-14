import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { join } from "path";

const { version } = JSON.parse(readFileSync(join(__dirname, "package.json"), "utf8")) as {
  version: string;
};
let piVersion = "unknown";
try {
  const piPkgPath = join(__dirname, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch {
  /* package not found, use default */
}

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-ai",
    // 上游 vendor 镜像仅在服务端经 child_process（comet .mjs）与 createRequire（autoplan）调用，
    // 绝不静态 import 进 bundle；此处显式列出作为防呆，确保即便未来误引用也不会被打包。
    "vendor/autoplan",
    "vendor/comet",
  ],
  // Reduce client JS size and skip shipping source maps in production
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
  compress: true,
  reactStrictMode: true,
  // 开发模式：忽略融合引擎的工作产物目录，避免「引擎写文件 → webpack 监听 → 全量
  // HMR 重建 → 浏览器冻结」的死循环。引擎把 comet 状态机产物写在 cwd 下
  // （openspec/changes/<change>/*.md 与根目录 .comet.yaml / .comet/），当用户以
  // 本项目自身作为引擎 cwd 调试时，这些写入会被 webpack 监听捕获并触发 30s+ 重建，
  // 使 dev UI 表现为「卡住」。生产构建不存在文件监听，故仅 dev 生效。
  webpack: (config, { dev }) => {
    // 抑制 autoplan-adapter 经 createRequire 运行时加载 vendored/autoplan 的
    // "Critical dependency: the request of a dependency is an expression" 警告。
    // 该 require 使用变量路径（modulePath），webpack 无法静态解析，但这是有意为之：
    // 仅在 ENGINE_AUTOPLAN_VENDOR=1 时由 Node 的 createRequire 运行时解析，
    // 正常情况下 vendored/autoplan 不存在、回退内存桩，webpack 无需（也不应）打包它。
    // 抑制 autoplan-adapter 经 createRequire 运行时加载 vendored/autoplan 的良性警告。
    // 注意：matcher 仅读取字符串属性（message/file/module.resource），绝不调用方法，
    // 否则 matcher 抛错会让整条路由构建失败（500）。
    const ignoreAutoPlanWarning = (warning: {
      message?: string;
      file?: string;
      module?: { resource?: string } | undefined;
    }): boolean => {
      const msg = warning?.message ?? "";
      if (!/the request of a dependency is an expression/.test(msg)) return false;
      const loc = String(warning?.file ?? warning?.module?.resource ?? "");
      return /autoplan-adapter/.test(loc);
    };
    config.ignoreWarnings = [
      ...(Array.isArray(config.ignoreWarnings) ? config.ignoreWarnings : []),
      ignoreAutoPlanWarning as (warning: unknown) => boolean,
    ];
    if (dev) {
      // 融合引擎把 comet 状态机产物写在 cwd 下（openspec/changes/<change>/*.md
      // 与根目录 .comet.yaml / .comet/）。当用户以本项目自身作为引擎 cwd 调试时，
      // 这些写入被 webpack 文件监听捕获 → 触发 30s+ 全量 HMR 重建 → dev UI「卡住」。
      // 开发模式忽略这些产物目录即可打断该循环。注意：webpack 5 的
      // watchOptions.ignored 仅接受 glob 字符串（不接受 RegExp），故此处用 glob
      // 覆盖 Next.js 默认的 node_modules/.next/.git 忽略（等价 glob）。生产无监听，不生效。
      // 注意：Next.js 的 webpack config 合并会把默认 watchOptions.ignored（RegExp）
      // 一并并入结果数组，而 webpack 5 的 watchOptions.ignored schema 仅接受字符串
      // glob（数组元素不接受 RegExp），会导致 "ignored[0] should be a non-empty string"
      // 校验失败。因此此处不 spread 默认 watchOptions，直接构建全新对象，确保其
      // ignored 仅含字符串 glob，且等价覆盖 node_modules/.next/.git 的默认忽略。
      config.watchOptions = {
        ignored: [
          "**/node_modules/**",
          "**/.next/**",
          "**/.git/**",
          "**/openspec/changes/**",
          "**/.comet.yaml",
          "**/.comet/**",
        ],
      };
    }
    return config;
  },
  // Optimize CSS: Tailwind v4 handles this automatically, but the explicit
  // config ensures Next.js applies its own CSS optimizations in prod builds.
  allowedDevOrigins: [
    "192.168.*.*",
    "10.*.*.*",
    "172.16.*.*",
    "172.17.*.*",
    "172.18.*.*",
    "172.19.*.*",
    "172.20.*.*",
    "172.21.*.*",
    "172.22.*.*",
    "172.23.*.*",
    "172.24.*.*",
    "172.25.*.*",
    "172.26.*.*",
    "172.27.*.*",
    "172.28.*.*",
    "172.29.*.*",
    "172.30.*.*",
    "172.31.*.*",
  ],
  async headers() {
    // The long-lived `immutable` cache for /_next/static MUST only apply in
    // production. Under `next dev` (Turbopack) those chunks are regenerated on
    // every recompile; serving them with `immutable` makes the browser pin a
    // stale dev chunk forever, desyncing the module registry and triggering the
    // "module factory is not available" runtime error on a clean compile.
    const isProd = process.env.NODE_ENV === "production";
    const result: Array<{
      source: string;
      headers: Array<{ key: string; value: string }>;
    }> = [];

    if (isProd) {
      // Long-lived cache for static assets (fonts, CSS, JS chunks with content hash)
      result.push({
        source: "/_next/static/:path*",
        headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }],
      });
      // Medium-lived cache for public assets
      result.push({
        source: "/:file(favicon.ico|robots.txt)",
        headers: [{ key: "Cache-Control", value: "public, max-age=86400" }],
      });
    }

    // No-cache for the main HTML page (dev + prod)
    result.push({
      source: "/",
      headers: [{ key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" }],
    });

    // Security headers
    // CSP rationale: pi-web is a local-only tool bound to localhost:30141.
    // Next.js App Router requires inline scripts for its bootstrap process
    // (self.__next_r, RSC client nav, etc.). React dev mode additionally
    // requires unsafe-eval for callstack reconstruction; React never uses
    // eval() in production, so the production CSP omits it.
    const scriptSrc = isProd ? "'self' 'unsafe-inline'" : "'self' 'unsafe-inline' 'unsafe-eval'";
    result.push({
      source: "/(.*)",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        {
          key: "Content-Security-Policy",
          value: [
            "default-src 'self'",
            `script-src ${scriptSrc}`,
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            "connect-src 'self'",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
          ].join("; "),
        },
      ],
    });

    return result;
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
