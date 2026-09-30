import React from 'react'
import { Sparkles, UserCheck, User } from 'lucide-react'
import { formatQuotaLabel } from '../quota'

export function QuotaBadge({ quota, user, onClick, disabled = false }) {
  const { remaining = 0, isGuest = true } = quota || {}

  // Color classes based on remaining quota
  let colorClasses = 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25'
  if (remaining === 0) {
    colorClasses = 'bg-rose-500/20 border-rose-500/40 text-rose-300 hover:bg-rose-500/30 animate-pulse'
  } else if (remaining <= 2) {
    colorClasses = 'bg-amber-500/20 border-amber-500/40 text-amber-300 hover:bg-amber-500/30'
  }

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`tap inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs font-semibold backdrop-blur-md active:scale-95 transition-all shadow-sm ${colorClasses} disabled:opacity-50`}
      title={isGuest ? 'Lượt quét dùng thử cho khách' : 'Số lượt quét khả dụng của tài khoản'}
      aria-label="Thông tin lượt quét"
    >
      {isGuest ? (
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
      ) : (
        <UserCheck className="h-3.5 w-3.5 shrink-0" />
      )}
      <span className="tabular-nums tracking-tight">{formatQuotaLabel(quota)}</span>
    </button>
  )
}

export function UserButton({ user, onClick, disabled = false }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="tap relative flex h-8 w-8 items-center justify-center rounded-xl glass-pill text-slate-200 active:scale-95 transition-all disabled:opacity-50"
      aria-label={user ? `Tài khoản ${user.email || ''}` : 'Đăng nhập'}
      title={user ? user.email : 'Đăng nhập'}
    >
      {user ? (
        <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-emerald-500/30 text-[11px] font-bold text-emerald-300 border border-emerald-400/40">
          {(user.email?.[0] || 'U').toUpperCase()}
        </div>
      ) : (
        <User className="h-4 w-4 text-slate-300" />
      )}
    </button>
  )
}
