import { cacheOwnerForUserId, LOCAL_DATA_SCHEMA_VERSION } from "@/security/cacheOwnership";
import { createLocalMMKV } from "@/security/localMMKV";

const SECURITY_STORAGE_ID = `circlebites.local-security.v${LOCAL_DATA_SCHEMA_VERSION}`;
const ACTIVE_OWNER_KEY = "active-owner-scope";

/**
 * The hardened pre-marker build already recorded its active account in the
 * ordinary app sandbox. Promote that exact owner match once so introducing the
 * durable document marker does not turn a normal upgrade into a reinstall.
 */
export function legacyInstallationOwnerMatches(userId: string) {
  try {
    const owner = cacheOwnerForUserId(userId);
    return createLocalMMKV(SECURITY_STORAGE_ID).getString(ACTIVE_OWNER_KEY) === owner.scope;
  } catch {
    return false;
  }
}
