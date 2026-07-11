import { type NextRequest, NextResponse } from "next/server";
import { uninstallExtension, listExtensionsWithState } from "@/lib/extensions/discovery";

export const dynamic = "force-dynamic";

// POST /api/extensions/uninstall — remove a local extension.
// body: { id: string }
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { id?: string };
    const id = body.id?.trim();
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    // Safety: bundled extensions cannot be uninstalled.
    const extensions = listExtensionsWithState();
    const ext = extensions.find((e) => e.id === id);
    if (ext && !ext.canUninstall) {
      return NextResponse.json(
        { error: `Cannot uninstall bundled extension "${id}". Disable it instead.` },
        { status: 400 },
      );
    }

    uninstallExtension(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
