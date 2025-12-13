import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

function unauthorizedResponse() {
  const res = new NextResponse("Authentication required", { status: 401 });
  res.headers.set("WWW-Authenticate", 'Basic realm="KRJ Reports"');
  return res;
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Only protect /krj (and any subpaths if we add them later)
  if (!pathname.startsWith("/krj")) {
    return NextResponse.next();
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader || !authHeader.startsWith("Basic ")) {
    return unauthorizedResponse();
  }

  const base64Credentials = authHeader.split(" ")[1];

  let decoded: string;
  try {
    decoded = Buffer.from(base64Credentials, "base64").toString("utf8");
  } catch {
    return unauthorizedResponse();
  }

  const [user, pass] = decoded.split(":");

  const expectedUser = process.env.KRJ_BASIC_USER || "krj";
  const expectedPass = process.env.KRJ_BASIC_PASS || "changeme";

  if (user === expectedUser && pass === expectedPass) {
    return NextResponse.next();
  }

  return unauthorizedResponse();
}

// Tell Next which paths use this middleware
export const config = {
  matcher: ["/krj/:path*", "/krj"],
};
