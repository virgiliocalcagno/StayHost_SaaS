import { NextRequest, NextResponse } from "next/server";

// TTLock sends GET to verify the callback URL — expects 200 "success"
export async function GET() {
  return new NextResponse("success", { status: 200 });
}

// TTLock sends unlock/lock events as POST
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    console.log("[ttlock/webhook] event:", JSON.stringify(body));
    return new NextResponse("success", { status: 200 });
  } catch {
    return new NextResponse("success", { status: 200 });
  }
}
