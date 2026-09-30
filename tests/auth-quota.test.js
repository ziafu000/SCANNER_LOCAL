import test, { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  GUEST_QUOTA_LIMIT,
  USER_QUOTA_LIMIT,
  GUEST_STORAGE_KEY,
  calculateQuotaState,
  getGuestScansUsed,
  setGuestScansUsed,
  getGuestQuota,
  consumeGuestScan,
  resetGuestQuota,
  canPerformScan,
  formatQuotaLabel,
} from '../src/quota.js'
import {
  isSupabaseConfigured,
  supabase,
  signInWithEmail,
  signUpWithEmail,
  signOutUser,
  fetchUserQuota,
  consumeUserScan,
} from '../src/supabase.js'

// Simple mock storage for testing
function createMockStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
    clear() {
      store.clear()
    },
  }
}

describe('Guest Scan Quota Service', () => {
  it('initializes guest quota to 5 scans', () => {
    const storage = createMockStorage()
    const quota = getGuestQuota(storage)

    assert.equal(quota.limit, GUEST_QUOTA_LIMIT)
    assert.equal(quota.limit, 5)
    assert.equal(quota.used, 0)
    assert.equal(quota.remaining, 5)
    assert.equal(quota.isGuest, true)
    assert.equal(canPerformScan(quota), true)
  })

  it('correctly tracks and consumes guest scans up to 5', () => {
    const storage = createMockStorage()

    // Scan 1
    const res1 = consumeGuestScan(storage)
    assert.equal(res1.success, true)
    assert.equal(res1.used, 1)
    assert.equal(res1.remaining, 4)
    assert.equal(canPerformScan(res1), true)

    // Scan 2
    const res2 = consumeGuestScan(storage)
    assert.equal(res2.success, true)
    assert.equal(res2.used, 2)
    assert.equal(res2.remaining, 3)

    // Scan 3, 4, 5
    consumeGuestScan(storage)
    consumeGuestScan(storage)
    const res5 = consumeGuestScan(storage)
    assert.equal(res5.success, true)
    assert.equal(res5.used, 5)
    assert.equal(res5.remaining, 0)
    assert.equal(canPerformScan(res5), false)

    // Attempt scan 6 (quota exceeded)
    const res6 = consumeGuestScan(storage)
    assert.equal(res6.success, false)
    assert.equal(res6.error, 'quota_exceeded')
    assert.equal(res6.used, 5)
    assert.equal(res6.remaining, 0)
    assert.equal(canPerformScan(res6), false)
  })

  it('resets guest quota back to 0 used scans', () => {
    const storage = createMockStorage({ [GUEST_STORAGE_KEY]: '5' })
    const before = getGuestQuota(storage)
    assert.equal(before.remaining, 0)

    const reset = resetGuestQuota(storage)
    assert.equal(reset.used, 0)
    assert.equal(reset.remaining, 5)
    assert.equal(canPerformScan(reset), true)
  })

  it('safely handles corrupt or non-numeric storage values', () => {
    const storage = createMockStorage({ [GUEST_STORAGE_KEY]: 'not-a-number' })
    const quota = getGuestQuota(storage)
    assert.equal(quota.used, 0)
    assert.equal(quota.remaining, 5)

    const negativeStorage = createMockStorage({ [GUEST_STORAGE_KEY]: '-99' })
    const negQuota = getGuestQuota(negativeStorage)
    assert.equal(negQuota.used, 0)
    assert.equal(negQuota.remaining, 5)
  })

  it('gracefully handles missing storage or exceptions (e.g. Safari private browsing)', () => {
    const failingStorage = {
      getItem() {
        throw new Error('SecurityError: The operation is insecure.')
      },
      setItem() {
        throw new Error('QuotaExceededError')
      },
    }

    const quota = getGuestQuota(failingStorage)
    assert.equal(quota.limit, 5)
    assert.equal(quota.used, 0)
    assert.equal(quota.remaining, 5)

    // Should not throw on consume
    const consumed = consumeGuestScan(failingStorage)
    assert.equal(consumed.success, true)
  })
})

describe('Authenticated User Quota Logic', () => {
  it('calculates authenticated user quota correctly for default 20 scans', () => {
    const initial = calculateQuotaState(USER_QUOTA_LIMIT, 0, false)
    assert.equal(initial.limit, 20)
    assert.equal(initial.used, 0)
    assert.equal(initial.remaining, 20)
    assert.equal(initial.isGuest, false)
    assert.equal(canPerformScan(initial), true)

    const usedSome = calculateQuotaState(20, 2, false)
    assert.equal(usedSome.used, 2)
    assert.equal(usedSome.remaining, 18)
    assert.equal(canPerformScan(usedSome), true)

    const exhausted = calculateQuotaState(20, 20, false)
    assert.equal(exhausted.used, 20)
    assert.equal(exhausted.remaining, 0)
    assert.equal(canPerformScan(exhausted), false)
  })

  it('clamps remaining quota to 0 when scans_used exceeds scans_limit', () => {
    const overused = calculateQuotaState(20, 25, false)
    assert.equal(overused.remaining, 0)
    assert.equal(canPerformScan(overused), false)
  })

  it('prevents scan execution and correctly handles quota rejection', () => {
    const quotaState = calculateQuotaState(20, 20, false)
    assert.equal(quotaState.remaining, 0)
    assert.equal(canPerformScan(quotaState), false)

    const rejectionResult = {
      success: false,
      error: 'quota_exceeded',
      limit: 20,
      used: 20,
      remaining: 0,
      isGuest: false,
    }
    assert.equal(rejectionResult.success, false)
    assert.equal(canPerformScan(rejectionResult), false)
  })

  it('formats human-readable labels for badges', () => {
    const guest5 = { limit: 5, used: 0, remaining: 5, isGuest: true }
    assert.equal(formatQuotaLabel(guest5), 'Còn 5/5 lượt thử')

    const guest0 = { limit: 5, used: 5, remaining: 0, isGuest: true }
    assert.equal(formatQuotaLabel(guest0), 'Còn 0/5 lượt thử')

    const user18 = { limit: 20, used: 2, remaining: 18, isGuest: false }
    assert.equal(formatQuotaLabel(user18), 'Còn 18/20 lượt')

    const user0 = { limit: 20, used: 20, remaining: 0, isGuest: false }
    assert.equal(formatQuotaLabel(user0), 'Còn 0/20 lượt')

    assert.equal(formatQuotaLabel(null), '0 lượt')
  })
})

describe('Supabase Client Safety & Fallback', () => {
  it('handles unconfigured environment without crashing', async () => {
    // When environment variables are not set in testing environment
    assert.equal(typeof isSupabaseConfigured, 'boolean')

    if (!isSupabaseConfigured) {
      assert.equal(supabase, null)

      // Auth methods should return graceful errors, not throw
      const signInRes = await signInWithEmail('test@example.com', 'secret123')
      assert.equal(signInRes.data, null)
      assert.ok(signInRes.error)

      const signUpRes = await signUpWithEmail('test@example.com', 'secret123')
      assert.equal(signUpRes.data, null)
      assert.ok(signUpRes.error)

      const signOutRes = await signOutUser()
      assert.equal(signOutRes.error, null)

      const quotaRes = await fetchUserQuota('user-123')
      assert.equal(quotaRes.limit, 20)
      assert.equal(quotaRes.remaining, 20)

      const consumeRes = await consumeUserScan('user-123')
      assert.equal(consumeRes.success, false)
      assert.equal(consumeRes.remaining, undefined)
    }
  })

  it('verifies Google OAuth is strictly excluded from client exports', async () => {
    const supabaseModule = await import('../src/supabase.js')
    assert.equal(typeof supabaseModule.signInWithGoogle, 'undefined')
  })

  it('ensures transport failure in consumeUserScan never injects false remaining: 0', async () => {
    // When consumeUserScan fails, remaining must not be 0 so clients do not lock out users falsely
    const res = await consumeUserScan(null)
    assert.equal(res.success, false)
    assert.notEqual(res.remaining, 0)
  })
})

