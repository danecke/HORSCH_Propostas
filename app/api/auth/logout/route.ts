import {
  deleteCurrentSession,
  expiredSessionCookie,
} from "../../../../lib/auth";

export const dynamic = "force-dynamic";

async function clearSession() {
  try {
    await deleteCurrentSession();
  } catch {
    // A expiração do cookie local ainda encerra a sessão no navegador.
  }
}

function expiredCookie(request: Request) {
  return expiredSessionCookie(new URL(request.url).protocol === "https:");
}

export async function GET(request: Request) {
  await clearSession();
  return new Response(null, {
    status: 303,
    headers: {
      Location: new URL("/", request.url).toString(),
      "Set-Cookie": expiredCookie(request),
      "Cache-Control": "no-store",
    },
  });
}

export async function POST(request: Request) {
  await clearSession();
  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": expiredCookie(request),
        "Cache-Control": "no-store",
      },
    },
  );
}
