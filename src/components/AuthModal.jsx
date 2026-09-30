import React, { useState } from 'react'
import {
  X,
  Mail,
  Lock,
  Eye,
  EyeOff,
  Sparkles,
  LogIn,
  UserPlus,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
} from 'lucide-react'

export function AuthModal({
  isOpen,
  onClose,
  authQuota,
  defaultMode = 'signin',
  onSuccess,
}) {
  const [mode, setMode] = useState(defaultMode === 'signup' ? 'signup' : 'signin') // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [successMessage, setSuccessMessage] = useState(null)

  if (!isOpen) return null

  const isConfigured = authQuota?.isConfigured ?? true

  const resetForm = () => {
    setError(null)
    setSuccessMessage(null)
  }

  const handleTabChange = (newMode) => {
    resetForm()
    setMode(newMode)
  }

  const translateError = (msg) => {
    if (!msg) return 'Đã có lỗi xảy ra. Vui lòng thử lại.'
    const lower = msg.toLowerCase()
    if (lower.includes('invalid login credentials') || lower.includes('invalid credentials')) {
      return 'Email hoặc mật khẩu không chính xác.'
    }
    if (lower.includes('email not confirmed')) {
      return 'Email chưa được xác thực. Vui lòng kiểm tra hộp thư của bạn.'
    }
    if (lower.includes('user already registered')) {
      return 'Tài khoản với email này đã tồn tại. Vui lòng chọn Đăng nhập.'
    }
    if (lower.includes('password should be at least')) {
      return 'Mật khẩu phải có ít nhất 6 ký tự.'
    }
    if (lower.includes('rate limit')) {
      return 'Bạn đã thao tác quá nhiều lần. Vui lòng đợi trong giây lát.'
    }
    return msg
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    resetForm()

    const cleanEmail = email.trim()
    if (!cleanEmail) {
      setError('Vui lòng nhập địa chỉ email.')
      return
    }

    if (!isConfigured) {
      setError('Chưa cấu hình Supabase. Vui lòng cài đặt VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY trong file .env.')
      return
    }

    setLoading(true)
    try {
      if (mode === 'signup') {
        if (!password || password.length < 6) {
          setError('Mật khẩu phải có ít nhất 6 ký tự.')
          setLoading(false)
          return
        }
        const res = await authQuota.signUpWithEmail(cleanEmail, password)
        if (!res.success) {
          setError(translateError(res.error))
        } else {
          setSuccessMessage('Đăng ký thành công! Bạn được nhận ngay 20 lượt quét.')
          onSuccess?.()
          setTimeout(() => {
            onClose()
          }, 1500)
        }
      } else {
        // Sign In
        if (!password) {
          setError('Vui lòng nhập mật khẩu.')
          setLoading(false)
          return
        }
        const res = await authQuota.signInWithEmail(cleanEmail, password)
        if (!res.success) {
          setError(translateError(res.error))
        } else {
          setSuccessMessage('Đăng nhập thành công!')
          onSuccess?.()
          setTimeout(() => {
            onClose()
          }, 1000)
        }
      }
    } catch (err) {
      setError(translateError(err.message))
    } finally {
      setLoading(false)
    }
  }

  const handleGoogleSignIn = async () => {
    resetForm()
    if (!isConfigured) {
      setError('Chưa cấu hình Supabase. Vui lòng cài đặt VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY trong file .env.')
      return
    }
    setLoading(true)
    try {
      const res = await authQuota.signInWithGoogle()
      if (!res.success) {
        setError(translateError(res.error))
      }
    } catch (err) {
      setError(translateError(err.message))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl glass-panel p-6 shadow-2xl border border-white/10 bg-slate-900/90 text-slate-100">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="tap absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 text-slate-400 hover:text-white active:scale-95 transition-all"
          aria-label="Đóng"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Modal Header */}
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-tr from-emerald-500/20 to-teal-500/20 border border-emerald-400/30 text-emerald-400 shadow-inner">
            <Sparkles className="h-6 w-6 stroke-[2]" />
          </div>
          <h2 id="auth-modal-title" className="text-xl font-bold tracking-tight text-white">
            {mode === 'signup'
              ? 'Tạo tài khoản SCANNER'
              : 'Đăng nhập tài khoản'}
          </h2>
          <p className="mt-1 text-xs text-slate-400">
            {mode === 'signup'
              ? 'Nhận ngay 20 lượt quét tài liệu miễn phí chất lượng cao'
              : 'Đồng bộ hạn mức lượt quét trên mọi thiết bị của bạn'}
          </p>
        </div>

        {/* Supabase Unconfigured Warning */}
        {!isConfigured && (
          <div className="mb-4 flex items-start gap-2.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            <AlertCircle className="h-4 w-4 shrink-0 text-amber-400 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-300">Chưa cấu hình Supabase</p>
              <p className="mt-0.5 text-amber-200/80 leading-relaxed">
                Ứng dụng đang chạy ở chế độ Khách cục bộ. Để dùng tài khoản trực tuyến, hãy thêm <code className="rounded bg-black/40 px-1 py-0.5 font-mono text-[10px]">VITE_SUPABASE_URL</code> và <code className="rounded bg-black/40 px-1 py-0.5 font-mono text-[10px]">VITE_SUPABASE_ANON_KEY</code> vào file .env.
              </p>
            </div>
          </div>
        )}

        {/* Mode Selector Tabs */}
        <div className="mb-5 flex rounded-2xl bg-black/30 p-1 border border-white/5">
          <button
            type="button"
            onClick={() => handleTabChange('signin')}
            className={`flex-1 rounded-xl py-2 text-xs font-semibold transition-all ${
              mode === 'signin'
                ? 'bg-emerald-500 text-slate-950 shadow-md font-bold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Đăng nhập
          </button>
          <button
            type="button"
            onClick={() => handleTabChange('signup')}
            className={`flex-1 rounded-xl py-2 text-xs font-semibold transition-all ${
              mode === 'signup'
                ? 'bg-emerald-500 text-slate-950 shadow-md font-bold'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Đăng ký (+20 lượt)
          </button>
        </div>

        {/* Error message */}
        {error && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300 animate-shake">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span className="flex-1">{error}</span>
          </div>
        )}

        {/* Success message */}
        {successMessage && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-3 text-xs text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
            <span className="flex-1">{successMessage}</span>
          </div>
        )}

        {/* Auth Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* Email field */}
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-300">
              Địa chỉ Email
            </label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tenban@example.com"
                autoComplete="email"
                className="w-full rounded-xl border border-white/10 bg-black/40 py-2.5 pl-10 pr-4 text-sm text-white placeholder-slate-500 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 transition-all"
              />
            </div>
          </div>

          {/* Password field */}
          <div>
            <div className="mb-1">
              <label className="text-xs font-medium text-slate-300">
                Mật khẩu
              </label>
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type={showPassword ? 'text' : 'password'}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === 'signup' ? 'Tối thiểu 6 ký tự' : 'Nhập mật khẩu'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                className="w-full rounded-xl border border-white/10 bg-black/40 py-2.5 pl-10 pr-10 text-sm text-white placeholder-slate-500 outline-none focus:border-emerald-400 focus:ring-1 focus:ring-emerald-400 transition-all"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white"
                aria-label={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="tap mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-400 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 active:scale-95 transition-all disabled:opacity-50"
          >
            {loading ? (
              <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-950 border-t-transparent" />
            ) : mode === 'signup' ? (
              <>
                <UserPlus className="h-4 w-4 stroke-[2.5]" />
                <span>Đăng ký &amp; Nhận 20 lượt</span>
              </>
            ) : (
              <>
                <LogIn className="h-4 w-4 stroke-[2.5]" />
                <span>Đăng nhập</span>
              </>
            )}
          </button>
        </form>

        {/* Divider */}
        <div className="relative my-4 flex items-center justify-center">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-white/10" />
          </div>
          <span className="relative bg-slate-900 px-3 text-[11px] uppercase tracking-wider text-slate-500">
            hoặc
          </span>
        </div>

        {/* Google OAuth Button */}
        <button
          type="button"
          disabled={loading}
          onClick={handleGoogleSignIn}
          className="tap flex w-full items-center justify-center gap-2.5 rounded-xl border border-white/10 bg-white/5 py-2.5 text-xs font-semibold text-slate-200 hover:bg-white/10 active:scale-95 transition-all disabled:opacity-50"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24">
            <path
              fill="#4285F4"
              d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            />
            <path
              fill="#34A853"
              d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            />
            <path
              fill="#FBBC05"
              d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
            />
            <path
              fill="#EA4335"
              d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
            />
          </svg>
          <span>Tiếp tục với Google</span>
        </button>

        {/* Privacy Note */}
        <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
          <span>Hình ảnh tài liệu scan luôn lưu bảo mật trên máy bạn</span>
        </div>
      </div>
    </div>
  )
}
