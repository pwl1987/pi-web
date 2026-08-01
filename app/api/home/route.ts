import { NextResponse } from "next/server";
import { homedir } from "os";
import { setCsrfCookie } from "@/lib/csrf";

export async function GET() {
  // /api/home is fetched by the sidebar on mount, making it a reliable
  // bootstrap point to plant the CSRF cookie (double-submit pattern).
  return setCsrfCookie(NextResponse.json({ home: homedir() }));
}
