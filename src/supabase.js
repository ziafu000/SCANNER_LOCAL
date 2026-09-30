import { createClient } from '@supabase/supabase-js'

const envUrl = typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL
const envKey = typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY

const supabaseUrl = typeof envUrl === 'string' ? envUrl.trim() : ''
const supabaseAnonKey = typeof envKey === 'string' ? envKey.trim() : ''

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl.startsWith('http')
)

/**
 * Initialize Supabase client safely.
 * If credentials are not provided, supabase is null and application runs in local/guest mode.
 */
export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null

/**
 * Sign in using email and password.
 */
export async function signInWithEmail(email, password) {
  if (!supabase) {
    return { data: null, error: { message: 'Supabase chưa được cấu hình' } }
  }
  return await supabase.auth.signInWithPassword({ email, password })
}

/**
 * Sign up using email and password.
 */
export async function signUpWithEmail(email, password) {
  if (!supabase) {
    return { data: null, error: { message: 'Supabase chưa được cấu hình' } }
  }
  return await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
    },
  })
}

/**
 * Sign in using Magic Link (OTP via email).
 */
export async function signInWithMagicLink(email) {
  if (!supabase) {
    return { data: null, error: { message: 'Supabase chưa được cấu hình' } }
  }
  return await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
    },
  })
}

/**
 * Sign in using Google OAuth.
 */
export async function signInWithGoogle() {
  if (!supabase) {
    return { data: null, error: { message: 'Supabase chưa được cấu hình' } }
  }
  return await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: typeof window !== 'undefined' ? window.location.origin : undefined,
    },
  })
}

/**
 * Sign out current user.
 */
export async function signOutUser() {
  if (!supabase) {
    return { error: null }
  }
  return await supabase.auth.signOut()
}

/**
 * Fetch user quota from Supabase database.
 * If quota record does not exist yet, creates default (limit: 20, used: 0).
 */
export async function fetchUserQuota(userId, email = '') {
  if (!supabase || !userId) {
    return { limit: 20, used: 0, remaining: 20, isGuest: false }
  }

  try {
    // Attempt 1: Call RPC get_user_quota if available
    const rpcRes = await supabase.rpc('get_user_quota')
    if (!rpcRes.error && rpcRes.data?.scans_limit !== undefined) {
      const data = rpcRes.data
      return {
        limit: data.scans_limit,
        used: data.scans_used,
        remaining: data.remaining ?? Math.max(0, data.scans_limit - data.scans_used),
        isGuest: false,
      }
    }

    // Attempt 2: Query user_quotas table directly
    const { data, error } = await supabase
      .from('user_quotas')
      .select('scans_limit, scans_used')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      console.warn('Không thể truy vấn user_quotas:', error.message)
      return { limit: 20, used: 0, remaining: 20, isGuest: false }
    }

    if (data) {
      return {
        limit: data.scans_limit ?? 20,
        used: data.scans_used ?? 0,
        remaining: Math.max(0, (data.scans_limit ?? 20) - (data.scans_used ?? 0)),
        isGuest: false,
      }
    }

    // Record does not exist: auto-insert default record
    const { data: newRow, error: insertError } = await supabase
      .from('user_quotas')
      .insert({
        id: userId,
        email: email || undefined,
        scans_limit: 20,
        scans_used: 0,
      })
      .select('scans_limit, scans_used')
      .maybeSingle()

    if (insertError) {
      console.warn('Không thể khởi tạo user_quotas:', insertError.message)
      return { limit: 20, used: 0, remaining: 20, isGuest: false }
    }

    return {
      limit: newRow?.scans_limit ?? 20,
      used: newRow?.scans_used ?? 0,
      remaining: Math.max(0, (newRow?.scans_limit ?? 20) - (newRow?.scans_used ?? 0)),
      isGuest: false,
    }
  } catch (err) {
    console.error('Lỗi khi lấy thông tin quota người dùng:', err)
    return { limit: 20, used: 0, remaining: 20, isGuest: false }
  }
}

/**
 * Consume one scan for an authenticated user.
 * Tries the atomic RPC consume_scan first, falling back to direct table update.
 */
export async function consumeUserScan(userId) {
  if (!supabase || !userId) {
    return { success: false, error: 'unauthorized', remaining: 0 }
  }

  try {
    // Attempt 1: RPC consume_scan
    const rpcRes = await supabase.rpc('consume_scan')
    if (!rpcRes.error && rpcRes.data?.success !== undefined) {
      const data = rpcRes.data
      return {
        success: data.success,
        limit: data.scans_limit ?? 20,
        used: data.scans_used ?? 0,
        remaining: data.remaining ?? Math.max(0, (data.scans_limit ?? 20) - (data.scans_used ?? 0)),
        error: data.error,
        isGuest: false,
      }
    }

    // Attempt 2: Fallback direct query and update
    const { data: row, error: selectError } = await supabase
      .from('user_quotas')
      .select('scans_limit, scans_used')
      .eq('id', userId)
      .maybeSingle()

    if (selectError) {
      return { success: false, error: selectError.message }
    }

    const limit = row?.scans_limit ?? 20
    const used = row?.scans_used ?? 0

    if (used >= limit) {
      return {
        success: false,
        error: 'quota_exceeded',
        limit,
        used,
        remaining: 0,
        isGuest: false,
      }
    }

    const nextUsed = used + 1
    const { error: updateError } = await supabase
      .from('user_quotas')
      .update({
        scans_used: nextUsed,
        updated_at: new Date().toISOString(),
      })
      .eq('id', userId)

    if (updateError) {
      return { success: false, error: updateError.message }
    }

    return {
      success: true,
      limit,
      used: nextUsed,
      remaining: Math.max(0, limit - nextUsed),
      isGuest: false,
    }
  } catch (err) {
    console.error('Lỗi khi trừ lượt quét Supabase:', err)
    return { success: false, error: err.message }
  }
}
