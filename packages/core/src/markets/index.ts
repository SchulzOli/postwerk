import type { MarketManifest } from '../market';
import { businessCentral } from './business-central';

/**
 * Target markets that ship with MarketingAsAService. Unlike themes they are
 * not installed in new workspaces: owners and admins install the markets
 * their workspace sells in. They update together with MarketingAsAService.
 */
export const builtinMarkets: readonly MarketManifest[] = [businessCentral];

export function builtinMarket(id: string): MarketManifest | undefined {
  return builtinMarkets.find((market) => market.id === id);
}
