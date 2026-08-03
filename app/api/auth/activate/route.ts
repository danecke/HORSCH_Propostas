export const dynamic = "force-dynamic";

export async function POST() {
  return Response.json(
    { error: "A ativação inicial foi desativada. Solicite seu acesso ao ADM." },
    { status: 404 },
  );
}
