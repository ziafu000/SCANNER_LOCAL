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
 * Sign out current user.
 */
export async function signOutUser() {
  if (!supabase) {
    return { error: null }
  }
  return await supabase.auth.signOut()
}

/**
 * Fetch user quota from Supabase database via RPC.
 */
export async function fetchUserQuota(userId) {
  if (!supabase || !userId) {
    return { limit: 20, used: 0, remaining: 20, isGuest: false }
  }

  try {
    const { data, error } = await supabase.rpc('get_user_quota')
    if (error) {
      console.warn('Lỗi khi gọi get_user_quota:', error.message)
      return { limit: 20, used: 0, remaining: 20, isGuest: false }
    }

    if (data && data.scans_limit !== undefined) {
      return {
        limit: data.scans_limit,
        used: data.scans_used ?? 0,
        remaining: data.remaining ?? Math.max(0, data.scans_limit - (data.scans_used ?? 0)),
        isGuest: false,
      }
    }

    return { limit: 20, used: 0, remaining: 20, isGuest: false }
  } catch (err) {
    console.error('Lỗi khi lấy thông tin quota người dùng:', err)
    return { limit: 20, used: 0, remaining: 20, isGuest: false }
  }
}

/**
 * Consume one scan for an authenticated user via atomic RPC.
 */
export async function consumeUserScan(userId) {
  if (!supabase || !userId) {
    return { success: false, error: 'unauthorized' }
  }

  try {
    const { data, error } = await supabase.rpc('consume_scan')
    if (error) {
      console.warn('Lỗi khi gọi consume_scan:', error.message)
      return { success: false, error: error.message }
    }

    if (data && data.success !== undefined) {
      const limit = data.scans_limit ?? 20
      const used = data.scans_used ?? 0
      const remaining = data.remaining ?? Math.max(0, limit - used)
      return {
        success: Boolean(data.success),
        limit,
        used,
        remaining,
        error: data.error,
        isGuest: false,
      }
    }

    return { success: false, error: 'unknown_response' }
  } catch (err) {
    console.error('Lỗi khi trừ lượt quét Supabase:', err)
    return { success: false, error: err.message }
  }
}
