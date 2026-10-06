import type { Bridge, BridgeId } from '../bridge';
import { zernio } from './zernio';

export const bridges: Record<BridgeId, Bridge> = { zernio };

export function getBridge(id: BridgeId): Bridge {
  return bridges[id];
}
