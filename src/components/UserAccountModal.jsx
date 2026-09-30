import React, { useState } from 'react'
import {
  X,
  User,
  LogOut,
  ShieldCheck,
  Sparkles,
  RefreshCw,
  HardDrive,
  Database,
} from 'lucide-react'

export function UserAccountModal({
  isOpen,
  onClose,
  user,
  quota,
  onSignOut,
  onRefreshQuota,
}) {
  const [signingOut, setSigningOut] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  if (!isOpen || !user) return null

  const { limit = 20, used = 0, remaining = 20 } = quota || {}
  const percentage = limit > 0 ? Math.round(((limit - used) / limit) * 100) : 0

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await onSignOut()
      onClose()
    } finally {
      setSigningOut(false)
    }
  }

  const handleRefresh = async () => {
    if (!onRefreshQuota) return
    setRefreshing(true)
    try {
      await onRefreshQuota()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="account-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-md animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative w-full max-w-md overflow-hidden rounded-3xl glass-panel p-6 shadow-2xl border border-white/10 bg-slate-900/90 text-slate-100">
        {/* Close button */}
        <button
          type="button"
          onClick={onClose}
          className="tap absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 text-slate-400 hover:text-white active:scale-95 transition-all"
          aria-label="Đóng"
        >
          <X className="h-4 w-4" />
        </button>

        {/* User Info Header */}
        <div className="mb-6 flex items-center gap-3.5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-tr from-emerald-500/20 to-teal-500/20 border border-emerald-400/40 text-emerald-300 text-xl font-bold shadow-inner">
            {(user.email?.[0] || 'U').toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-400 border border-emerald-500/30">
                <Sparkles className="h-2.5 w-2.5" />
                Thành viên
              </span>
            </div>
            <p id="account-modal-title" className="mt-1 truncate text-sm font-semibold text-white">
              {user.email}
            </p>
            <p className="text-[11px] text-slate-400">
              Đồng bộ dữ liệu Supabase Auth
            </p>
          </div>
        </div>

        {/* Quota Card */}
        <div className="mb-5 rounded-2xl border border-white/10 bg-black/40 p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-300">
              Hạn mức lượt quét
            </span>
            <button
              type="button"
              disabled={refreshing}
              onClick={handleRefresh}
              className="tap flex items-center gap-1 text-[11px] text-emerald-400 hover:text-emerald-300 active:scale-95 transition-all disabled:opacity-50"
              title="Làm mới số lượt quét"
            >
              <RefreshCw className={`h-3 w-3 ${refreshing ? 'animate-spin' : ''}`} />
              <span>Đồng bộ</span>
            </button>
          </div>

          <div className="flex items-baseline justify-between mb-2">
            <div>
              <span className="text-2xl font-extrabold text-emerald-400">
                {remaining}
              </span>
              <span className="text-sm font-medium text-slate-400">
                /{limit} lượt còn lại
              </span>
            </div>
            <span className="text-xs font-semibold text-slate-400">
              Đã dùng: {used}
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
            <div
              className={`h-full transition-all duration-500 ${
                remaining === 0
                  ? 'bg-rose-500'
                  : remaining <= 2
                  ? 'bg-amber-400'
                  : 'bg-gradient-to-r from-emerald-400 to-teal-400'
              }`}
              style={{ width: `${Math.max(5, Math.min(100, percentage))}%` }}
            />
          </div>
        </div>

        {/* Security & Storage Note */}
        <div className="mb-5 space-y-2 rounded-2xl border border-white/5 bg-slate-800/40 p-3.5 text-xs text-slate-300">
          <div className="flex items-center gap-2 font-medium text-emerald-300">
            <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-400" />
            <span>Quyền riêng tư tuyệt đối</span>
          </div>
          <div className="space-y-1 text-[11px] text-slate-400 leading-relaxed">
            <div className="flex items-start gap-1.5">
              <HardDrive className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
              <span>Hình ảnh tài liệu đã scan chỉ lưu cục bộ trên thiết bị của bạn (IndexedDB).</span>
            </div>
            <div className="flex items-start gap-1.5">
              <Database className="h-3.5 w-3.5 text-slate-400 shrink-0 mt-0.5" />
              <span>Supabase chỉ quản lý tài khoản và số lượt quét, không lưu trữ ảnh scan.</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            type="button"
            disabled={signingOut}
            onClick={handleSignOut}
            className="tap flex flex-1 items-center justify-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 py-2.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 active:scale-95 transition-all disabled:opacity-50"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>{signingOut ? 'Đang đăng xuất…' : 'Đăng xuất'}</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="tap flex-1 rounded-xl bg-white/10 py-2.5 text-xs font-semibold text-slate-200 hover:bg-white/15 active:scale-95 transition-all"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  )
}
