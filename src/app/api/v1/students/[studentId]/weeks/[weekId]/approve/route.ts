// P4.1 backward-compat shim: POST /approve becomes /amend.
// The legacy approve endpoint required no body; the amend endpoint requires
// row_version + reason. The shim synthesises a default row_version when the
// caller has not yet loaded a summary and lets the service reject the call
// with VERSION_CONFLICT if the row_version is stale.
import { p4Command } from "../../../../../../../../server/p4-http";
export async function POST(
  request: Request,
  context: { params: Promise<{ studentId: string; weekId: string }> },
) {
  const { studentId, weekId } = await context.params;
  return p4Command(request, async (service, body, key) => {
    let parsed: Record<string, unknown> = {};
    if (body && typeof body === "object" && !Array.isArray(body))
      parsed = body as Record<string, unknown>;
    const payload = {
      row_version:
        typeof parsed.row_version === "number" &&
        Number.isInteger(parsed.row_version) &&
        parsed.row_version > 0
          ? (parsed.row_version as number)
          : 1,
      reason:
        typeof parsed.reason === "string" && parsed.reason.length >= 3
          ? parsed.reason
          : "Legacy approve after P4.1 migration",
    };
    return service.amendWeek(studentId, weekId, payload, key);
  });
}
