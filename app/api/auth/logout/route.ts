import {
  deleteCurrentSession,
  expiredSessionCookie,
} from "../../../../lib/auth";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    await deleteCurrentSession();
  } catch {
    // A expiração do cookie local ainda encerra a sessão no navegador.
  }
  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": expiredSessionCookie(
          new URL(request.url).protocol === "https:",
        ),
      },
    },
  );
}
