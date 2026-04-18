import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    let data: Record<string, any> = {};

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const formData = await req.formData();
      formData.forEach((value, key) => {
        data[key] = value;
      });
    } else if (contentType.includes("application/json")) {
      data = await req.json();
    } else {
      // Fallback for some configurations that might send raw text or other formats
      const text = await req.text();
      try {
        data = JSON.parse(text);
      } catch {
        data = { raw: text };
      }
    }

    // Log the event for debugging (visible in terminal running `npm run dev`)
    console.log("-----------------------------------------");
    console.log(">>> TTLOCK WEBHOOK RECEIVED");
    console.log("Timestamp:", new Date().toISOString());
    console.log("Payload:", JSON.stringify(data, null, 2));
    console.log("-----------------------------------------");

    /**
     * Common TTLock payload fields:
     * - lockId: ID of the lock
     * - recordType: 1=App, 4=Passcode, 7=IC Card, etc.
     * - success: 1 for success, 0 for failure
     * - lockDate: Epoch timestamp
     * - username: The name of the user who unlocked (if available)
     */

    // Response expected by TTLock to acknowledge receipt
    return NextResponse.json({
      errcode: 0,
      errmsg: "success"
    });
  } catch (err) {
    console.error(">>> TTLOCK WEBHOOK ERROR:", err);
    // Return success anyway so TTLock doesn't keep retrying a failed parse
    return NextResponse.json({
      errcode: 0,
      errmsg: "logged with errors"
    });
  }
}

// TTLock sometimes sends a GET request to verify the URL
export async function GET() {
  return new NextResponse("TTLock Webhook Endpoint Active", { status: 200 });
}
