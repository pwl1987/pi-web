import { resolveSessionPath, getSessionHeaderCached } from "@/lib/session-reader";
import { getRpcSession, startRpcSession } from "@/lib/rpc-manager";

export const dynamic = "force-dynamic";

// GET /api/agent/[id]/events - SSE stream of agent events
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // Fast path: already-running session
  let session = getRpcSession(id);
  if (!session || !session.isAlive()) {
    const filePath = await resolveSessionPath(id);
    if (!filePath) {
      return new Response("Session not found", { status: 404 });
    }
    const cwd = (getSessionHeaderCached(filePath)?.cwd as string) ?? process.cwd();
    try {
      ({ session } = await startRpcSession(id, filePath, cwd));
    } catch (error) {
      // P6：并发超限时返回 429（SSE 路由保持纯文本风格）。
      const status =
        error instanceof Error && "statusCode" in error
          ? (error as { statusCode?: number }).statusCode
          : undefined;
      return new Response(`Failed to start agent: ${error}`, {
        status: typeof status === "number" ? status : 500,
      });
    }
  }

  const stream = new ReadableStream({
    start(controller) {
      const encode = (data: unknown) => {
        const text = `data: ${JSON.stringify(data)}\n\n`;
        controller.enqueue(new TextEncoder().encode(text));
      };

      // Send initial connected event
      encode({ type: "connected", sessionId: id });

      const unsubscribe = session.onEvent((event) => {
        encode(event);
      });

      // Heartbeat every 30s to prevent server/proxy timeout (Next.js default ~120-150s)
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(new TextEncoder().encode(":\n\n"));
        } catch {
          // controller already closed
        }
      }, 30_000);
      heartbeat.unref(); // 不阻止进程优雅退出

      // Cleanup when client disconnects
      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // controller already closed
        }
        // L7 修复：客户端断连（关标签页/网络断开）后，AgentSession 仍在后台
        // 跑会持续烧 token。此处检测会话仍在运行则显式 abort，停止后台工作。
        // 用 guard 防止心跳/多次 abort 触发重复 abort；abort 是幂等的，
        // 即使会话已结束也安全（send 内部 guard 已处理 _alive 状态）。
        if (!cleanedUp && session.isRunning()) {
          cleanedUp = true;
          void session.send({ type: "abort" }).catch(() => {});
        }
      };
      let cleanedUp = false;

      // Detect client disconnect via abort signal
      req.signal?.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
