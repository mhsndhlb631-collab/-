import {
  mentorOperationsMutation,
  mentorOperationsQuery,
} from "../../../../server/mentor-operations-http";
export const dynamic = "force-dynamic";
export function GET(request: Request) {
  return mentorOperationsQuery(request);
}
export function POST(request: Request) {
  return mentorOperationsMutation(request);
}
