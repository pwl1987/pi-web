// Next.js instrumentation（Node runtime）。
// 在进程启动时运行，为 S1 访问网关把访问令牌哈希注入 process.env，
// 供同进程 Edge middleware 经 env 读取（Edge 不能读本地文件）。
//
// 仅在未显式配置 PI_WEB_ACCESS_TOKEN_HASH 时生成/复用令牌，避免覆盖
// 生产部署（bin/pi-web.js 已注入）传入的值。

export async function register() {
  if (process.env.PI_WEB_ACCESS_TOKEN_HASH) return;
  // 避免测试/构建阶段无谓生成令牌。
  if (process.env.NODE_ENV === "test") return;

  try {
    const { ensureAccessToken } = await import("../lib/access-token.ts");
    const { hash } = ensureAccessToken();
    if (hash) {
      process.env.PI_WEB_ACCESS_TOKEN_HASH = hash;
    }
  } catch {
    // 失败时留空：middleware 对「未配置哈希」采取 D2 强制拒绝（dev 也适用）。
  }
}
