import type { PosWorkspace } from "./types";

/** Never reuse a branch-specific server grant after changing stores or going offline. */
export function hasCurrentHandoverGrant(online: boolean, branchId: string, workspace: PosWorkspace | null): boolean {
  return Boolean(online && branchId && workspace?.branch.id === branchId && workspace.canCollectPhysicalHandover);
}
