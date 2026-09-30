import React from 'react'
import {
  Sparkles,
  AlertTriangle,
  X,
  LogIn,
  UserPlus,
  ShieldCheck,
} from 'lucide-react'

export function QuotaExceededModal({
  isOpen,
  onClose,
  isGuest = true,
  onOpenAuth,
}) {
  if (!isOpen) return null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="quota-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative w-full max-w-sm overflow-hidden rounded-3xl glass-panel p-6 shadow-2xl border border-white/10 bg-slate-900/95 text-slate-100 text-center">
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          className="tap absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-xl bg-white/5 text-slate-400 hover:text-white active:scale-95 transition-all"
          aria-label="Đóng"
        >
          <X className="h-4 w-4" />
        </button>

        {/* Icon */}
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-500/20 border border-amber-500/30 text-amber-400 shadow-inner">
          <AlertTriangle className="h-7 w-7 stroke-[2]" />
        </div>

        {/* Title */}
        <h3 id="quota-modal-title" className="text-lg font-bold tracking-tight text-white mb-2">
          {isGuest ? 'Hết lượt quét thử miễn phí' : 'Đã dùng hết 20 lượt quét'}
        </h3>

        {/* Description */}
        <p className="text-xs text-slate-300 leading-relaxed mb-5">
          {isGuest ? (
            <>
              Bạn đã sử dụng hết <span className="font-bold text-amber-300">5 lượt quét dùng thử</span> của chế độ khách. Đăng nhập hoặc tạo tài khoản để nhận ngay <span className="font-bold text-emerald-400">20 lượt quét miễn phí</span>!
            </>
          ) : (
            <>
              Tài khoản của bạn đã đạt giới hạn <span className="font-bold text-amber-300">20 lượt quét</span>. Các tài liệu đã quét vẫn được lưu an toàn trong Thư viện trên thiết bị của bạn.
            </>
          )}
        </p>

        {/* CTA buttons */}
        <div className="space-y-2.5">
          {isGuest ? (
            <>
              <button
                type="button"
                onClick={() => {
                  onClose()
                  onOpenAuth?.('signup')
                }}
                className="tap flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-400 to-teal-400 py-3 text-sm font-bold text-slate-950 shadow-lg shadow-emerald-500/20 active:scale-95 transition-all"
              >
                <UserPlus className="h-4 w-4 stroke-[2.5]" />
                <span>Đăng ký nhận 20 lượt</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onClose()
                  onOpenAuth?.('signin')
                }}
                className="tap flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 py-2.5 text-xs font-semibold text-slate-200 hover:bg-white/10 active:scale-95 transition-all"
              >
                <LogIn className="h-3.5 w-3.5" />
                <span>Đã có tài khoản? Đăng nhập</span>
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="tap flex w-full items-center justify-center rounded-xl bg-white/10 py-3 text-xs font-semibold text-slate-200 hover:bg-white/15 active:scale-95 transition-all"
            >
              Đã hiểu
            </button>
          )}
        </div>

        {/* Privacy Note */}
        <div className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
          <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
          <span>Dữ liệu scan của bạn luôn an toàn trên máy</span>
        </div>
      </div>
    </div>
  )
}
