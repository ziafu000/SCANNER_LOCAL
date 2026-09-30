import { useState, useEffect, useCallback, useRef } from 'react'
import {
  supabase,
  isSupabaseConfigured,
  signInWithEmail as sbSignInWithEmail,
  signUpWithEmail as sbSignUpWithEmail,
  signInWithGoogle as sbSignInWithGoogle,
  signOutUser as sbSignOutUser,
  fetchUserQuota,
  consumeUserScan,
} from '../supabase'
import {
  getGuestQuota,
  consumeGuestScan,
  canPerformScan,
  calculateQuotaState,
  GUEST_QUOTA_LIMIT,
  USER_QUOTA_LIMIT,
} from '../quota'

export function useAuthQuota() {
  const [user, setUser] = useState(null)
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [quota, setQuota] = useState(() => getGuestQuota())
  const [authError, setAuthError] = useState(null)
  const userRef = useRef(user)

  useEffect(() => {
    userRef.current = user
  }, [user])

  // Load quota for current state (Guest or Authenticated user)
  const refreshQuota = useCallback(async (targetUser) => {
    const currentUser = targetUser !== undefined ? targetUser : userRef.current
    if (!currentUser) {
      const gQuota = getGuestQuota()
      setQuota(gQuota)
      return gQuota
    }

    try {
      const uQuota = await fetchUserQuota(currentUser.id)
      const state = calculateQuotaState(uQuota.limit ?? USER_QUOTA_LIMIT, uQuota.used ?? 0, false)
      setQuota(state)
      return state
    } catch (err) {
      console.error('Lỗi khi tải quota:', err)
      const fallback = calculateQuotaState(USER_QUOTA_LIMIT, 0, false)
      setQuota(fallback)
      return fallback
    }
  }, [])

  // Initialize auth listener
  useEffect(() => {
    let mounted = true

    if (!isSupabaseConfigured || !supabase) {
      setQuota(getGuestQuota())
      setLoading(false)
      return
    }

    // Get initial session
    supabase.auth.getSession().then(({ data: { session: initialSession }, error }) => {
      if (!mounted) return
      if (error) {
        console.warn('Lỗi lấy phiên đăng nhập:', error.message)
      }
      setSession(initialSession)
      setUser(initialSession?.user ?? null)
      if (initialSession?.user) {
        refreshQuota(initialSession.user)
      } else {
        setQuota(getGuestQuota())
      }
      setLoading(false)
    })

    // Listen to auth state transitions
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!mounted) return
      setSession(newSession)
      setUser(newSession?.user ?? null)

      if (newSession?.user) {
        await refreshQuota(newSession.user)
      } else {
        setQuota(getGuestQuota())
      }
      setLoading(false)
    })

    return () => {
      mounted = false
      subscription?.unsubscribe()
    }
  }, [refreshQuota])

  // Check if current user or guest has remaining scans
  const canScan = useCallback(() => {
    return canPerformScan(quota)
  }, [quota])

  // Consume 1 scan upon successful page scan/confirmation
  const consumeScan = useCallback(async () => {
    if (!canScan()) {
      return { success: false, error: 'quota_exceeded', ...quota }
    }

    if (!user) {
      // Guest mode - track in localStorage
      const result = consumeGuestScan()
      setQuota(result)
      return result
    }

    // Authenticated user mode - sync with Supabase
    try {
      const result = await consumeUserScan(user.id)
      if (result.success) {
        setQuota({
          limit: result.limit,
          used: result.used,
          remaining: result.remaining,
          isGuest: false,
        })
      } else if (result.error === 'quota_exceeded' || result.remaining !== undefined) {
        const remaining = result.remaining ?? 0
        const limit = result.limit ?? quota.limit
        setQuota({
          limit,
          used: result.used ?? (limit - remaining),
          remaining,
          isGuest: false,
        })
      }
      return result
    } catch (err) {
      console.error('Lỗi trừ lượt quét:', err)
      // Fallback optimistic update
      const fallbackQuota = calculateQuotaState(
        quota.limit,
        quota.used + 1,
        false
      )
      setQuota(fallbackQuota)
      return { success: true, ...fallbackQuota }
    }
  }, [canScan, quota, user])

  // Auth helper methods
  const signInWithEmail = useCallback(async (email, password) => {
    setAuthError(null)
    const res = await sbSignInWithEmail(email, password)
    if (res.error) {
      setAuthError(res.error.message)
      return { success: false, error: res.error.message }
    }
    return { success: true, user: res.data?.user }
  }, [])

  const signUpWithEmail = useCallback(async (email, password) => {
    setAuthError(null)
    const res = await sbSignUpWithEmail(email, password)
    if (res.error) {
      setAuthError(res.error.message)
      return { success: false, error: res.error.message }
    }
    return { success: true, user: res.data?.user }
  }, [])

  const signInWithGoogle = useCallback(async () => {
    setAuthError(null)
    const res = await sbSignInWithGoogle()
    if (res?.error) {
      setAuthError(res.error.message)
      return { success: false, error: res.error.message }
    }
    return { success: true }
  }, [])

  const signOut = useCallback(async () => {
    setAuthError(null)
    await sbSignOutUser()
    setUser(null)
    setSession(null)
    const gQuota = getGuestQuota()
    setQuota(gQuota)
    return { success: true }
  }, [])

  return {
    user,
    session,
    loading,
    isGuest: !user,
    isConfigured: isSupabaseConfigured,
    quota,
    authError,
    canScan,
    consumeScan,
    refreshQuota,
    signInWithEmail,
    signUpWithEmail,
    signInWithGoogle,
    signOut,
  }
}
