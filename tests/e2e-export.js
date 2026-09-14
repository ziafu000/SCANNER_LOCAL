import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const EVIDENCE_DIR = '/home/asus/.no-mistakes/evidence/01M2G27Z5ERZ6QZ5SE4T78FD23'
const VITE_PORT = 5190
const CHROME_PORT = 9225

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

function cleanupPorts() {
  try {
    execSync(`fuser -k ${VITE_PORT}/tcp ${CHROME_PORT}/tcp 2>/dev/null || true`)
  } catch {}
}

function createCdpClient(ws) {
  let id = 0
  const callbacks = new Map()

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && callbacks.has(msg.id)) {
      const cb = callbacks.get(msg.id)
      callbacks.delete(msg.id)
      if (msg.error) cb.reject(new Error(msg.error.message || JSON.stringify(msg.error)))
      else cb.resolve(msg.result)
    }
  }

  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const msgId = ++id
        callbacks.set(msgId, { resolve, reject })
        ws.send(JSON.stringify({ id: msgId, method, params }))
      })
    }
  }
}

async function evalInPage(cdp, expr, { awaitPromise = false } = {}) {
  const wrapped = expr.trim().startsWith('(() =>') || expr.trim().startsWith('(async () =>')
    ? expr
    : `(() => { ${expr} })()`

  const res = await cdp.send('Runtime.evaluate', {
    expression: wrapped,
    returnByValue: true,
    awaitPromise
  })

  if (res.exceptionDetails) {
    const desc = res.exceptionDetails.exception?.description || res.exceptionDetails.text
    throw new Error(`Evaluation exception: ${desc}`)
  }
  return res.result?.value
}

async function run() {
  cleanupPorts()
  console.log('--- Starting E2E Export Test Suite ---')
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  }

  // 1. Start Vite
  console.log(`[1/6] Spawning Vite dev server on port ${VITE_PORT}...`)
  const vite = spawn('npx', ['vite', '--port', String(VITE_PORT), '--strictPort', '--host', '127.0.0.1'], {
    stdio: 'pipe'
  })

  let viteReady = false
  for (let i = 0; i < 40; i++) {
    await sleep(150)
    try {
      const res = await fetch(`http://127.0.0.1:${VITE_PORT}/`)
      if (res.ok) {
        viteReady = true
        break
      }
    } catch {}
  }
  if (!viteReady) {
    vite.kill('SIGKILL')
    throw new Error('Vite dev server failed to start')
  }

  // 2. Launch Chrome Headless
  console.log(`[2/6] Launching Google Chrome headless on port ${CHROME_PORT}...`)
  const chrome = spawn('google-chrome', [
    '--headless=new',
    `--remote-debugging-port=${CHROME_PORT}`,
    '--disable-gpu',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--use-fake-device-for-media-stream',
    '--use-fake-ui-for-media-stream',
    '--window-size=430,932',
    'about:blank'
  ], { stdio: 'pipe' })

  let ws = null
  try {
    let targets = null
    for (let i = 0; i < 40; i++) {
      await sleep(150)
      try {
        const res = await fetch(`http://127.0.0.1:${CHROME_PORT}/json`)
        targets = await res.json()
        if (targets && targets.length > 0) break
      } catch {}
    }

    const pageTarget = targets.find(t => t.type === 'page')
    if (!pageTarget) throw new Error('No page target found in Chrome')

    ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
    await new Promise(resolve => { ws.onopen = resolve })
    const cdp = createCdpClient(ws)

    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('DOM.enable')

    // Emulate iPhone 14/15 Pro mobile viewport (430x932, 3x DPR)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 430,
      height: 932,
      deviceScaleFactor: 2,
      mobile: true
    })

    console.log(`[3/6] Navigating to http://127.0.0.1:${VITE_PORT}/...`)
    await cdp.send('Page.navigate', { url: `http://127.0.0.1:${VITE_PORT}/` })

    console.log('  Waiting for OpenCV and App initialization...')
    let appReady = false
    for (let i = 0; i < 60; i++) {
      await sleep(250)
      const val = await evalInPage(cdp, `return Boolean(window.cv && window.cv.Mat && document.querySelector('button[aria-label="Chụp tài liệu"]'))`)
      if (val === true) {
        appReady = true
        break
      }
    }
    if (!appReady) throw new Error('App or OpenCV did not initialize within timeout')

    // -------------------------------------------------------------
    // TEST 1: Gallery View Screen & Image Export
    // -------------------------------------------------------------
    console.log('[4/6] Testing Gallery View Screen & Image Export...')

    // Seed IndexedDB with sample scanned documents
    await evalInPage(cdp, `
      (async () => {
        async function makeSampleBlob(colorText) {
          const c = document.createElement('canvas');
          c.width = 400; c.height = 550;
          const ctx = c.getContext('2d');
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, 400, 550);
          ctx.fillStyle = '#1e293b';
          ctx.font = 'bold 24px sans-serif';
          ctx.fillText(colorText, 40, 80);
          ctx.fillStyle = '#64748b';
          ctx.font = '16px sans-serif';
          ctx.fillText('Sample Document Page Content', 40, 120);
          ctx.fillRect(40, 140, 320, 2);
          return new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));
        }

        const blob1 = await makeSampleBlob('Trang 1: Hợp Đồng');
        const blob2 = await makeSampleBlob('Trang 2: Phụ Lục');

        const req = indexedDB.open('scanner-db', 1);
        await new Promise((resolve, reject) => {
          req.onsuccess = async (e) => {
            const db = e.target.result;
            const tx = db.transaction('scans', 'readwrite');
            const store = tx.objectStore('scans');
            store.put({
              id: 'doc-hop-dong-1',
              name: 'Hop-dong-kinh-te',
              createdAt: Date.now() - 3600000,
              pages: [blob1, blob2]
            });
            tx.oncomplete = resolve;
            tx.onerror = reject;
          };
          req.onerror = reject;
        });
      })()
    `, { awaitPromise: true })

    // Reload page so refreshGallery() loads the seeded scan
    await cdp.send('Page.reload')
    console.log('  Waiting for App and OpenCV reload...')
    appReady = false
    for (let i = 0; i < 60; i++) {
      await sleep(250)
      const val = await evalInPage(cdp, `return Boolean(window.cv && window.cv.Mat && document.querySelector('button[aria-label="Chụp tài liệu"]'))`)
      if (val === true) {
        appReady = true
        break
      }
    }
    if (!appReady) throw new Error('App failed to reload')

    // Install Web Share spy and mock environment in page
    const injectShareSpy = `
      window.__shareCalls = [];
      window.__downloadCalls = [];
      window.__mockAbort = false;
      window.__mockCanShareResult = true;

      navigator.canShare = function(data) {
        if (window.__mockCanShareResult !== undefined) return window.__mockCanShareResult;
        return true;
      };

      navigator.share = async function(data) {
        if (window.__mockAbort) {
          const err = new DOMException('The share operation was canceled', 'AbortError');
          throw err;
        }
        window.__shareCalls.push({
          title: data.title,
          fileNames: (data.files || []).map(f => f.name),
          fileTypes: (data.files || []).map(f => f.type),
          filesCount: (data.files || []).length
        });
        return Promise.resolve();
      };

      const origCreateElement = document.createElement.bind(document);
      document.createElement = function(tagName) {
        const el = origCreateElement(tagName);
        if (tagName.toLowerCase() === 'a') {
          const origClick = el.click.bind(el);
          el.click = function() {
            window.__downloadCalls.push({
              href: el.href,
              download: el.download
            });
            origClick();
          };
        }
        return el;
      };
    `
    await evalInPage(cdp, injectShareSpy)

    // Open Gallery
    await evalInPage(cdp, `document.querySelector('button[aria-label="Thư viện"]').click()`)
    await sleep(400)

    // Click on Hop-dong-kinh-te
    await evalInPage(cdp, `
      const rBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Hop-dong-kinh-te'));
      if (rBtn) rBtn.click();
    `)
    await sleep(500)

    // Verify Gallery View UI elements
    const gvCheck = await evalInPage(cdp, `
      const title = document.querySelector('h1')?.textContent;
      const buttons = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim());
      const hasSaveToPhotos = buttons.some(t => t.includes('Lưu vào Album ảnh'));
      const hasExportPdf = buttons.some(t => t.includes('Xuất lại file PDF'));
      const singlePageBtns = document.querySelectorAll('button[aria-label^="Lưu ảnh trang"]');
      return {
        title,
        hasSaveToPhotos,
        hasExportPdf,
        singlePageCount: singlePageBtns.length
      };
    `)
    console.log('  Gallery View UI check:', gvCheck)
    if (!gvCheck.hasSaveToPhotos) throw new Error('Gallery View missing "Lưu vào Album ảnh" button')
    if (gvCheck.singlePageCount !== 2) throw new Error(`Expected 2 single page buttons, found ${gvCheck.singlePageCount}`)

    // Capture Evidence 1: Gallery View screen with export buttons
    const ss1 = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const ss1Path = path.join(EVIDENCE_DIR, '01-gallery-view-export-buttons.png')
    fs.writeFileSync(ss1Path, Buffer.from(ss1.data, 'base64'))
    console.log(`  Saved screenshot: ${ss1Path}`)

    // Test Quick Single Page Download from Gallery View
    await evalInPage(cdp, `
      window.__shareCalls = [];
      const btn = document.querySelector('button[aria-label="Lưu ảnh trang 1"]');
      btn.click();
    `)
    await sleep(350)

    const gvSingleCheck = await evalInPage(cdp, `
      return {
        shareCalls: window.__shareCalls,
        toast: document.querySelector('.animate-in')?.textContent || ''
      };
    `)
    console.log('  Gallery single page export result:', gvSingleCheck)
    if (gvSingleCheck.shareCalls.length !== 1) throw new Error('Single page share call missing')
    const gvSingleCall = gvSingleCheck.shareCalls[0]
    if (gvSingleCall.filesCount !== 1 || gvSingleCall.fileTypes[0] !== 'image/jpeg' || !gvSingleCall.fileNames[0].endsWith('trang-1.jpg')) {
      throw new Error(`Unexpected single page share file: ${JSON.stringify(gvSingleCall)}`)
    }

    // Capture Evidence 2: Gallery View Single Page Download Toast
    const ss2 = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const ss2Path = path.join(EVIDENCE_DIR, '02-gallery-view-single-page-toast.png')
    fs.writeFileSync(ss2Path, Buffer.from(ss2.data, 'base64'))
    console.log(`  Saved screenshot: ${ss2Path}`)

    // Test Batch "Lưu vào Album ảnh" from Gallery View
    await sleep(600)
    await evalInPage(cdp, `
      window.__shareCalls = [];
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Lưu vào Album ảnh'));
      btn.click();
    `)
    await sleep(400)

    const gvBatchCheck = await evalInPage(cdp, `
      return {
        shareCalls: window.__shareCalls,
        toast: document.querySelector('.animate-in')?.textContent || ''
      };
    `)
    console.log('  Gallery batch export result:', gvBatchCheck)
    if (gvBatchCheck.shareCalls.length !== 1) throw new Error('Gallery batch share call missing')
    const gvBatchCall = gvBatchCheck.shareCalls[0]
    if (gvBatchCall.filesCount !== 2 || !gvBatchCall.fileNames.every(n => n.endsWith('.jpg'))) {
      throw new Error(`Unexpected gallery batch files: ${JSON.stringify(gvBatchCall)}`)
    }

    // Capture Evidence 3: Gallery View Batch Toast
    const ss3 = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const ss3Path = path.join(EVIDENCE_DIR, '03-gallery-view-batch-toast.png')
    fs.writeFileSync(ss3Path, Buffer.from(ss3.data, 'base64'))
    console.log(`  Saved screenshot: ${ss3Path}`)

    // -------------------------------------------------------------
    // TEST 2: Cart Screen & Quick Single Page Download & Cart Export
    // -------------------------------------------------------------
    console.log('[5/6] Testing Cart Screen & Image Export...')

    // Navigate back to camera screen: Header back button in gallery view -> gallery list -> camera
    await evalInPage(cdp, `document.querySelector('header button')?.click()`)
    await sleep(400)
    await evalInPage(cdp, `document.querySelector('header button')?.click()`)
    await sleep(600)

    const screenAfterBack = await evalInPage(cdp, `
      return {
        h1: document.querySelector('h1')?.textContent,
        hasCaptureBtn: Boolean(document.querySelector('button[aria-label="Chụp tài liệu"]')),
        status: document.body.innerText
      };
    `)
    console.log('  Screen after back from gallery:', screenAfterBack)

    // Helper to capture a page from camera into cart
    async function capturePageIntoCart(pageNumber) {
      console.log(`  Capturing Page ${pageNumber} into cart...`)
      await evalInPage(cdp, `document.querySelector('button[aria-label="Chụp tài liệu"]')?.click()`)
      await sleep(700)

      // In adjust screen: click "Áp dụng 4 góc & Cắt"
      await evalInPage(cdp, `
        const applyBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Áp dụng 4 góc'));
        if (applyBtn) applyBtn.click();
      `)
      await sleep(600)

      // In confirm screen: click "Xác nhận thêm"
      await evalInPage(cdp, `
        const confirmBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Xác nhận thêm'));
        if (confirmBtn) confirmBtn.click();
      `)
      await sleep(800)
    }

    await capturePageIntoCart(1)
    await capturePageIntoCart(2)

    // Open Cart Screen by clicking "{pages.length} trang" button
    await evalInPage(cdp, `
      const cartBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('trang'));
      if (cartBtn) cartBtn.click();
    `)
    await sleep(500)

    // Set docName in input
    await evalInPage(cdp, `
      const input = document.querySelector('input');
      if (input) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
        setter.call(input, "Bao-cao-quy-1");
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    `)
    await sleep(200)

    // Verify Cart screen UI
    const cartCheck = await evalInPage(cdp, `
      const buttons = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim());
      const hasSaveToPhotos = buttons.some(t => t.includes('Lưu vào Album ảnh'));
      const hasExportPdf = buttons.some(t => t.includes('Xong & Xuất PDF'));
      const singlePageBtns = document.querySelectorAll('button[aria-label^="Lưu ảnh trang"]');
      const docName = document.querySelector('input')?.value;
      return {
        hasSaveToPhotos,
        hasExportPdf,
        singlePageCount: singlePageBtns.length,
        docName
      };
    `)
    console.log('  Cart screen check:', cartCheck)
    if (!cartCheck.hasSaveToPhotos) throw new Error('Cart screen missing "Lưu vào Album ảnh" button')
    if (cartCheck.singlePageCount < 2) throw new Error(`Expected at least 2 single-page buttons in cart, got ${cartCheck.singlePageCount}`)

    // Capture Evidence 4: Cart Screen with export buttons and per-page icons
    const ss4 = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const ss4Path = path.join(EVIDENCE_DIR, '04-cart-export-buttons.png')
    fs.writeFileSync(ss4Path, Buffer.from(ss4.data, 'base64'))
    console.log(`  Saved screenshot: ${ss4Path}`)

    // Test Quick Single Page Download from Cart (Page 1)
    await evalInPage(cdp, `
      window.__shareCalls = [];
      const btn = document.querySelector('button[aria-label="Lưu ảnh trang 1"]');
      btn.click();
    `)
    await sleep(350)

    const cartSingleCheck = await evalInPage(cdp, `
      return {
        shareCalls: window.__shareCalls,
        toast: document.querySelector('.animate-in')?.textContent || ''
      };
    `)
    console.log('  Cart single page export result:', cartSingleCheck)
    if (cartSingleCheck.shareCalls.length !== 1) throw new Error('Cart single page share call missing')
    const cartSingleCall = cartSingleCheck.shareCalls[0]
    if (cartSingleCall.filesCount !== 1 || !cartSingleCall.fileNames[0].startsWith('Bao-cao-quy-1-trang-1')) {
      throw new Error(`Unexpected cart single page filename: ${JSON.stringify(cartSingleCall)}`)
    }

    // Capture Evidence 5: Cart Single Page Download Toast
    const ss5 = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const ss5Path = path.join(EVIDENCE_DIR, '05-cart-single-page-toast.png')
    fs.writeFileSync(ss5Path, Buffer.from(ss5.data, 'base64'))
    console.log(`  Saved screenshot: ${ss5Path}`)

    // Test AbortError Handling in Cart (Review finding 2: export-cart-images-ignore-abort)
    console.log('  Testing AbortError cancellation in Cart export...')
    await sleep(500)
    await evalInPage(cdp, `
      window.__mockAbort = true;
      window.__shareCalls = [];
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Lưu vào Album ảnh'));
      btn.click();
    `)
    await sleep(400)

    const abortResult = await evalInPage(cdp, `
      const buttons = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim());
      const stillInCart = buttons.some(t => t.includes('Lưu vào Album ảnh'));
      const pageCount = document.querySelectorAll('button[aria-label^="Lưu ảnh trang"]').length;
      return { stillInCart, pageCount };
    `)
    console.log('  Abort handling result (cart preserved):', abortResult)
    if (!abortResult.stillInCart || abortResult.pageCount < 2) {
      throw new Error('AbortError improperly wiped cart or navigated away!')
    }

    // Test Successful "Lưu vào Album ảnh" from Cart
    console.log('  Executing successful Cart "Lưu vào Album ảnh" export...')
    await evalInPage(cdp, `
      window.__mockAbort = false;
      window.__shareCalls = [];
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Lưu vào Album ảnh'));
      btn.click();
    `)
    await sleep(600)

    const cartBatchResult = await evalInPage(cdp, `
      const hasCaptureBtn = Boolean(document.querySelector('button[aria-label="Chụp tài liệu"]'));
      const toast = document.querySelector('.animate-in')?.textContent || '';
      return {
        shareCalls: window.__shareCalls,
        hasCaptureBtn,
        toast
      };
    `)
    console.log('  Cart batch export success result:', cartBatchResult)
    if (cartBatchResult.shareCalls.length !== 1) throw new Error('Expected 1 share call for cart batch export')
    const cartBatchCall = cartBatchResult.shareCalls[0]
    if (cartBatchCall.filesCount < 2 || !cartBatchCall.fileNames[0].startsWith('Bao-cao-quy-1')) {
      throw new Error(`Invalid cart batch call: ${JSON.stringify(cartBatchCall)}`)
    }
    if (!cartBatchResult.hasCaptureBtn) {
      throw new Error('App did not return to camera screen after successful cart export')
    }

    // Capture Evidence 6: Returned to camera screen with success toast
    const ss6 = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const ss6Path = path.join(EVIDENCE_DIR, '06-camera-saved-toast.png')
    fs.writeFileSync(ss6Path, Buffer.from(ss6.data, 'base64'))
    console.log(`  Saved screenshot: ${ss6Path}`)

    // -------------------------------------------------------------
    // TEST 3: Web Share Fallback to download when canShare returns false
    // -------------------------------------------------------------
    console.log('[6/6] Testing fallback download when canShare returns false...')
    // Open Gallery -> open record
    await evalInPage(cdp, `document.querySelector('button[aria-label="Thư viện"]').click()`)
    await sleep(400)
    await evalInPage(cdp, `
      const rBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Hop-dong-kinh-te'));
      if (rBtn) rBtn.click();
    `)
    await sleep(500)

    await evalInPage(cdp, `
      window.__mockCanShareResult = false;
      window.__downloadCalls = [];
      window.__shareCalls = [];
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Lưu vào Album ảnh'));
      btn.click();
    `)
    await sleep(900)

    const fallbackResult = await evalInPage(cdp, `
      return {
        shareCalls: window.__shareCalls,
        downloadCalls: window.__downloadCalls
      };
    `)
    console.log('  Fallback download result:', fallbackResult)
    if (fallbackResult.shareCalls.length !== 0) {
      throw new Error('navigator.share should NOT be called when canShare returns false')
    }
    if (fallbackResult.downloadCalls.length !== 2) {
      throw new Error(`Expected 2 fallback downloads, got ${fallbackResult.downloadCalls.length}`)
    }
    if (!fallbackResult.downloadCalls[0].download.endsWith('.jpg')) {
      throw new Error(`Expected .jpg download, got ${fallbackResult.downloadCalls[0].download}`)
    }

    console.log('\n--- All E2E checks passed successfully! ---')
  } finally {
    if (ws) ws.close()
    chrome.kill('SIGKILL')
    vite.kill('SIGKILL')
    cleanupPorts()
  }
}

run().catch(err => {
  cleanupPorts()
  console.error('Test failed:', err)
  process.exit(1)
})
