/**
 * Quota management service for SCANNER PWA.
 * Handles both Guest (local storage up to 5 scans) and Authenticated users (database up to 20 scans).
 */

export const GUEST_QUOTA_LIMIT = 5
export const USER_QUOTA_LIMIT = 20
export const GUEST_STORAGE_KEY = 'scanner_guest_scans_used'

/**
 * Get safe storage reference (window.localStorage or custom provided storage).
 */
function getStorage(customStorage) {
  if (customStorage !== undefined) return customStorage
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage
    }
  } catch {
    // LocalStorage might be disabled or throwing security exception (e.g. strict Safari Private)
  }
  return null
}

/**
 * Calculate standard quota object from limit and used count.
 */
export function calculateQuotaState(limit = GUEST_QUOTA_LIMIT, used = 0, isGuest = false) {
  const safeLimit = Math.max(0, Number.isFinite(limit) ? Number(limit) : 0)
  const safeUsed = Math.max(0, Number.isFinite(used) ? Number(used) : 0)
  const remaining = Math.max(0, safeLimit - safeUsed)

  return {
    limit: safeLimit,
    used: safeUsed,
    remaining,
    isGuest: Boolean(isGuest)
  }
}

/**
 * Read the number of scans used by a guest from local storage.
 */
export function getGuestScansUsed(storage) {
  const s = getStorage(storage)
  if (!s) return 0
  try {
    const raw = s.getItem(GUEST_STORAGE_KEY)
    if (raw === null || raw === undefined) return 0
    const parsed = parseInt(raw, 10)
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0
  } catch {
    return 0
  }
}

/**
 * Save the number of scans used by a guest into local storage.
 */
export function setGuestScansUsed(used, storage) {
  const s = getStorage(storage)
  const safeUsed = Math.max(0, Number.isFinite(used) ? Number(used) : 0)
  if (!s) return safeUsed
  try {
    s.setItem(GUEST_STORAGE_KEY, String(safeUsed))
  } catch {
    // Ignore storage write errors (e.g. quota exceeded in storage)
  }
  return safeUsed
}

/**
 * Get the current guest quota status.
 */
export function getGuestQuota(storage) {
  const used = getGuestScansUsed(storage)
  return calculateQuotaState(GUEST_QUOTA_LIMIT, used, true)
}

/**
 * Consume one scan for a guest.
 * Returns updated quota state and success boolean.
 */
export function consumeGuestScan(storage) {
  const current = getGuestQuota(storage)
  if (current.remaining <= 0) {
    return {
      success: false,
      error: 'quota_exceeded',
      ...current
    }
  }

  const newUsed = current.used + 1
  setGuestScansUsed(newUsed, storage)
  const updated = calculateQuotaState(GUEST_QUOTA_LIMIT, newUsed, true)

  return {
    success: true,
    ...updated
  }
}

/**
 * Reset guest quota to 0 used scans.
 */
export function resetGuestQuota(storage) {
  setGuestScansUsed(0, storage)
  return getGuestQuota(storage)
}

/**
 * Determine if a user or guest is permitted to scan.
 */
export function canPerformScan(quota) {
  if (!quota) return false
  return (quota.remaining ?? 0) > 0
}

/**
 * Human-readable quota label for UI badges.
 * Guest: "Còn 5/5 lượt thử"
 * User: "Còn 18/20 lượt"
 */
export function formatQuotaLabel(quota) {
  if (!quota) return '0 lượt'
  const { remaining = 0, limit = 0, isGuest = false } = quota
  if (isGuest) {
    return `Còn ${remaining}/${limit} lượt thử`
  }
  return `Còn ${remaining}/${limit} lượt`
}
