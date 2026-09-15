import React from 'react'
import { AlertTriangle, RefreshCw, Camera } from 'lucide-react'

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('ErrorBoundary caught error:', error, errorInfo)
    if (this.props.onError) {
      this.props.onError(error, errorInfo)
    }
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
    if (this.props.onReset) {
      this.props.onReset()
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return typeof this.props.fallback === 'function'
          ? this.props.fallback({ error: this.state.error, reset: this.handleReset })
          : this.props.fallback
      }

      return React.createElement(
        'div',
        {
          'data-testid': 'error-boundary-fallback',
          className: 'flex min-h-screen w-full flex-col items-center justify-center bg-slate-950 p-6 text-center text-white select-none'
        },
        React.createElement(
          'div',
          {
            className: 'flex h-16 w-16 items-center justify-center rounded-2xl bg-red-500/20 text-red-400 border border-red-500/30 mb-4 shadow-xl'
          },
          React.createElement(AlertTriangle, { className: 'h-8 w-8' })
        ),
        React.createElement(
          'h2',
          { className: 'text-xl font-bold text-white mb-2' },
          'Đã xảy ra sự cố hiển thị'
        ),
        React.createElement(
          'p',
          { className: 'text-sm text-slate-400 max-w-sm mb-6 leading-relaxed' },
          'Ứng dụng gặp lỗi khi xử lý thao tác. Bạn có thể thử lại hoặc quay lại màn hình chụp ảnh.'
        ),
        React.createElement(
          'div',
          { className: 'flex flex-col sm:flex-row items-center gap-3 w-full max-w-xs' },
          React.createElement(
            'button',
            {
              onClick: this.handleReset,
              className: 'tap flex w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-400 to-teal-400 py-3.5 px-6 font-bold text-slate-950 shadow-lg shadow-emerald-500/20 active:scale-95 transition-all'
            },
            React.createElement(RefreshCw, { className: 'h-5 w-5' }),
            React.createElement('span', null, 'Thử lại')
          ),
          this.props.onNavigateCamera
            ? React.createElement(
                'button',
                {
                  onClick: () => {
                    this.handleReset()
                    this.props.onNavigateCamera()
                  },
                  className: 'tap flex w-full items-center justify-center gap-2 rounded-2xl glass-panel py-3.5 px-6 font-semibold text-slate-200 active:scale-95 transition-all'
                },
                React.createElement(Camera, { className: 'h-5 w-5' }),
                React.createElement('span', null, 'Về Camera')
              )
            : null
        )
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
