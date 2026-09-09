// P4.1 backward-compat shim: POST /ready becomes /finalize.
// Existing clients that still call /ready keep working until they migrate.
import { p4Command } from "../../../../../../../../server/p4-http";
export async function POST(
  request: Request,
  context: { params: Promise<{ studentId: string; weekId: string }> },
) {
  const { studentId, weekId } = await context.params;
  return p4Command(request, (service, body, key) =>
    service.finalizeWeek(studentId, weekId, body, key),
  );
}
