import type { NextRequest } from "next/server";

const hopByHopHeaders = ["host", "connection", "content-length", "transfer-encoding", "keep-alive", "upgrade"];

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const apiOrigin = (process.env.API_URL ?? "http://localhost:4000").replace(/\/$/, "");
  const target = `${apiOrigin}/${path.join("/")}${request.nextUrl.search}`;

  const headers = new Headers(request.headers);
  for (const header of hopByHopHeaders) headers.delete(header);
  headers.delete("accept-encoding");

  const body = ["GET", "HEAD"].includes(request.method) ? undefined : await request.arrayBuffer();

  let response: Response;
  try {
    response = await fetch(target, {
      method: request.method,
      headers,
      body,
      redirect: "manual",
      cache: "no-store",
    });
  } catch {
    return Response.json({ statusCode: 503, message: "The API is unreachable" }, { status: 503 });
  }

  const responseHeaders = new Headers(response.headers);
  responseHeaders.delete("content-encoding");
  responseHeaders.delete("content-length");
  responseHeaders.delete("transfer-encoding");

  return new Response(response.body, { status: response.status, headers: responseHeaders });
}

export { proxy as DELETE, proxy as GET, proxy as HEAD, proxy as OPTIONS, proxy as PATCH, proxy as POST, proxy as PUT };
