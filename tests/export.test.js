import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { shareOrDownloadImages } from '../src/export.js'

function setMockNavigator(mock) {
  Object.defineProperty(globalThis, 'navigator', {
    value: mock,
    configurable: true,
    writable: true
  })
}

describe('shareOrDownloadImages unit tests', { concurrency: false }, () => {
  it('invokes navigator.share when canShare is true', async () => {
    const shared = []
    const downloads = []

    setMockNavigator({
      canShare: ({ files }) => files && files.length > 0,
      share: async (data) => {
        shared.push(data)
        return Promise.resolve()
      }
    })

    const file1 = new File(['page1'], 'doc-trang-1.jpg', { type: 'image/jpeg' })
    const file2 = new File(['page2'], 'doc-trang-2.jpg', { type: 'image/jpeg' })

    const ok = await shareOrDownloadImages([file1, file2], 'Test Doc', (file, name) => {
      downloads.push({ file, name })
    })

    assert.strictEqual(ok, true, 'expected share to succeed')
    assert.strictEqual(shared.length, 1, 'expected 1 call to navigator.share')
    assert.strictEqual(shared[0].title, 'Test Doc')
    assert.strictEqual(shared[0].files.length, 2)
    assert.strictEqual(shared[0].files[0].name, 'doc-trang-1.jpg')
    assert.strictEqual(downloads.length, 0, 'download fallback must not be called when share succeeds')
  })

  it('returns false and does not download when user cancels share sheet (AbortError)', async () => {
    const downloads = []

    setMockNavigator({
      canShare: () => true,
      share: async () => {
        const err = new DOMException('Share canceled', 'AbortError')
        throw err
      }
    })

    const file = new File(['data'], 'page-1.jpg', { type: 'image/jpeg' })
    const ok = await shareOrDownloadImages([file], 'Page 1', (file, name) => {
      downloads.push({ file, name })
    })

    assert.strictEqual(ok, false, 'expected return value false on AbortError')
    assert.strictEqual(downloads.length, 0, 'download fallback must not trigger on AbortError cancellation')
  })

  it('falls back to download when navigator.share throws unexpected error', async () => {
    const downloads = []

    setMockNavigator({
      canShare: () => true,
      share: async () => {
        throw new Error('OS error')
      }
    })

    const file = new File(['data'], 'page-1.jpg', { type: 'image/jpeg' })
    const ok = await shareOrDownloadImages([file], 'Page 1', (f, name) => {
      downloads.push({ f, name })
    })

    assert.strictEqual(ok, true, 'expected fallback download to succeed and return true')
    assert.strictEqual(downloads.length, 1)
    assert.strictEqual(downloads[0].name, 'page-1.jpg')
  })

  it('falls back to download when canShare returns false', async () => {
    const downloads = []

    setMockNavigator({
      canShare: () => false,
      share: async () => {
        throw new Error('should not be called')
      }
    })

    const file1 = new File(['d1'], 'doc-trang-1.jpg', { type: 'image/jpeg' })
    const file2 = new File(['d2'], 'doc-trang-2.jpg', { type: 'image/jpeg' })

    const start = Date.now()
    const ok = await shareOrDownloadImages([file1, file2], 'Fallback Doc', (f, name) => {
      downloads.push({ f, name })
    })
    const elapsed = Date.now() - start

    assert.strictEqual(ok, true)
    assert.strictEqual(downloads.length, 2)
    assert.strictEqual(downloads[0].name, 'doc-trang-1.jpg')
    assert.strictEqual(downloads[1].name, 'doc-trang-2.jpg')
    assert.ok(elapsed >= 200, `expected at least 250ms spacing between downloads, elapsed: ${elapsed}ms`)
  })

  it('falls back to download when navigator.canShare is undefined', async () => {
    const downloads = []

    setMockNavigator({})

    const file = new File(['content'], 'single-page.jpg', { type: 'image/jpeg' })
    const ok = await shareOrDownloadImages([file], 'Single Page', (f, name) => {
      downloads.push({ f, name })
    })

    assert.strictEqual(ok, true)
    assert.strictEqual(downloads.length, 1)
    assert.strictEqual(downloads[0].name, 'single-page.jpg')
  })

  it('concurrent share execution guard prevents double-triggering', async () => {
    let shareInProgress = false
    let duplicateCalls = 0
    let completedCalls = 0

    setMockNavigator({
      canShare: () => true,
      share: async () => {
        if (shareInProgress) {
          duplicateCalls++
        }
        shareInProgress = true
        await new Promise(r => setTimeout(r, 100))
        shareInProgress = false
        completedCalls++
        return Promise.resolve()
      }
    })

    let processing = false
    async function guardedExport(file, name) {
      if (processing) return false
      processing = true
      try {
        return await shareOrDownloadImages([file], name)
      } finally {
        processing = false
      }
    }

    const file = new File(['img'], 'test.jpg', { type: 'image/jpeg' })
    const p1 = guardedExport(file, 'test.jpg')
    const p2 = guardedExport(file, 'test.jpg')

    const [res1, res2] = await Promise.all([p1, p2])

    assert.strictEqual(res1, true, 'first export should succeed')
    assert.strictEqual(res2, false, 'concurrent export should be blocked by processing guard')
    assert.strictEqual(duplicateCalls, 0, 'no overlapping share calls should reach the Web Share API')
    assert.strictEqual(completedCalls, 1, 'only one share call should complete')
    assert.strictEqual(processing, false, 'processing guard must be unlocked after completion')
  })

  it('cart export cancellation preserves cart items and does not commit scan', async () => {
    setMockNavigator({
      canShare: () => true,
      share: async () => {
        const err = new DOMException('User canceled share sheet', 'AbortError')
        throw err
      }
    })

    let cart = [
      { id: '1', blob: new Blob(['p1']), name: 'page 1' },
      { id: '2', blob: new Blob(['p2']), name: 'page 2' }
    ]
    let gallerySaved = false

    async function mockExportCart(pages, docName) {
      const files = pages.map((p, i) => new File([p.blob], `${docName}-trang-${i + 1}.jpg`, { type: 'image/jpeg' }))
      const ok = await shareOrDownloadImages(files, docName)
      if (!ok) {
        return false
      }
      gallerySaved = true
      cart = []
      return true
    }

    const result = await mockExportCart(cart, 'Tai-lieu-quan-trong')

    assert.strictEqual(result, false, 'cart export should return false on user cancellation')
    assert.strictEqual(cart.length, 2, 'cart pages must be preserved when user cancels share')
    assert.strictEqual(gallerySaved, false, 'cancelled export must not save record to gallery')
  })
})
