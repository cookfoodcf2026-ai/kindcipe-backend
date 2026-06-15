// SSE sync is not used in self-hosted deployment
import { router } from "./trpc";
export const sseSyncRouter = router({});
export function broadcastToFamily(_familyId: number, _event: string, _data: unknown): void {
  // Not implemented in self-hosted version
}
