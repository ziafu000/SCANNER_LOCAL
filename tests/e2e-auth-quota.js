import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const EVIDENCE_DIR = '/home/asus/.no-mistakes/evidence/01M3RGWP10X38AHQK9F361R3E2'
const VITE_PORT = 5199
const CHROME_PORT = 9249

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
  const eventListeners = new Map()

  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && callbacks.has(msg.id)) {
      const cb = callbacks.get(msg.id)
      callbacks.delete(msg.id)
      if (msg.error) cb.reject(new Error(msg.error.message || JSON.stringify(msg.error)))
      else cb.resolve(msg.result)
    } else if (msg.method && eventListeners.has(msg.method)) {
      for (const listener of eventListeners.get(msg.method)) {
        listener(msg.params)
      }
    }
  }

  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const msgId = ++id
        callbacks.set(msgId, { resolve, reject })
        ws.send(JSON.stringify({ id: msgId, method, params }))
      })
    },
    on(event, handler) {
      if (!eventListeners.has(event)) {
        eventListeners.set(event, new Set())
      }
      eventListeners.get(event).add(handler)
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
  console.log('--- Starting E2E Auth & Quota Test Suite ---')
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  }

  // 1. Start Vite with mock Supabase environment variables
  console.log(`[1/7] Spawning Vite dev server on port ${VITE_PORT}...`)
  const vite = spawn('npx', ['vite', '--port', String(VITE_PORT), '--strictPort', '--host', '127.0.0.1'], {
    stdio: 'pipe',
    env: {
      ...process.env,
      VITE_SUPABASE_URL: 'https://scanner-mock.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'mock-anon-key-scanner-tests'
    }
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
  console.log(`[2/7] Launching Google Chrome headless on port ${CHROME_PORT}...`)
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

    const pageTarget = targets?.find(t => t.type === 'page')
    if (!pageTarget) throw new Error('No page target found in Chrome')

    ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
    await new Promise(resolve => { ws.onopen = resolve })
    const cdp = createCdpClient(ws)

    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('DOM.enable')

    // Set mobile viewport (iPhone 14/15 Pro: 430x932, 2x DPR)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 430,
      height: 932,
      deviceScaleFactor: 2,
      mobile: true
    })

    // Setup Supabase Mock HTTP Interception via CDP Fetch
    await cdp.send('Fetch.enable', {
      patterns: [{ urlPattern: '*scanner-mock.supabase.co*' }]
    })

    let userQuota = { scans_limit: 20, scans_used: 2, remaining: 18 }

    cdp.on('Fetch.requestPaused', async (params) => {
      const { requestId, request } = params
      const url = request.url
      const method = request.method
      console.log(`    [Fetch Intercepted] ${method} ${url}`)

      const corsHeaders = [
        { name: 'Content-Type', value: 'application/json' },
        { name: 'Access-Control-Allow-Origin', value: '*' },
        { name: 'Access-Control-Allow-Methods', value: 'GET, POST, OPTIONS, PUT, DELETE' },
        { name: 'Access-Control-Allow-Headers', value: '*' }
      ]

      if (method === 'OPTIONS') {
        await cdp.send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 200,
          responseHeaders: corsHeaders,
          body: Buffer.from('{}').toString('base64')
        })
        return
      }

      if (url.includes('/auth/v1/token')) {
        // Successful login
        const authData = {
          access_token: 'mock-access-token-12345',
          token_type: 'bearer',
          expires_in: 3600,
          refresh_token: 'mock-refresh-token',
          user: {
            id: 'u-8899-auth-test',
            aud: 'authenticated',
            role: 'authenticated',
            email: 'thanh.nguyen@scanner.app',
            created_at: new Date().toISOString()
          }
        }
        await cdp.send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 200,
          responseHeaders: corsHeaders,
          body: Buffer.from(JSON.stringify(authData)).toString('base64')
        })
        return
      }

      if (url.includes('/auth/v1/logout')) {
        await cdp.send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 200,
          responseHeaders: corsHeaders,
          body: Buffer.from('{}').toString('base64')
        })
        return
      }

      if (url.includes('/rpc/get_user_quota')) {
        await cdp.send('Fetch.fulfillRequest', {
          requestId,
          responseCode: 200,
          responseHeaders: corsHeaders,
          body: Buffer.from(JSON.stringify(userQuota)).toString('base64')
        })
        return
      }

      if (url.includes('/rpc/consume_scan')) {
        if (userQuota.remaining > 0) {
          userQuota.scans_used += 1
          userQuota.remaining -= 1
          const response = {
            success: true,
            scans_limit: userQuota.scans_limit,
            scans_used: userQuota.scans_used,
            remaining: userQuota.remaining
          }
          await cdp.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders: corsHeaders,
            body: Buffer.from(JSON.stringify(response)).toString('base64')
          })
        } else {
          const response = {
            success: false,
            error: 'quota_exceeded',
            scans_limit: userQuota.scans_limit,
            scans_used: userQuota.scans_used,
            remaining: 0
          }
          await cdp.send('Fetch.fulfillRequest', {
            requestId,
            responseCode: 200,
            responseHeaders: corsHeaders,
            body: Buffer.from(JSON.stringify(response)).toString('base64')
          })
        }
        return
      }

      // Default continue
      try {
        await cdp.send('Fetch.continueRequest', { requestId })
      } catch {}
    })

    console.log(`[3/7] Navigating to http://127.0.0.1:${VITE_PORT}/...`)
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

    // Seed initial sample document into local IndexedDB
    await evalInPage(cdp, `
      (async () => {
        const c = document.createElement('canvas');
        c.width = 400; c.height = 550;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#0f172a';
        ctx.fillRect(0, 0, 400, 550);
        ctx.fillStyle = '#10b981';
        ctx.font = 'bold 22px sans-serif';
        ctx.fillText('Giấy Tờ Gia Đình', 30, 80);
        ctx.fillStyle = '#e2e8f0';
        ctx.font = '16px sans-serif';
        ctx.fillText('Lưu trữ cục bộ trên máy', 30, 130);
        const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.9));

        const req = indexedDB.open('scanner-db', 1);
        await new Promise((resolve, reject) => {
          req.onsuccess = (e) => {
            const db = e.target.result;
            const tx = db.transaction('scans', 'readwrite');
            tx.objectStore('scans').put({
              id: 'doc-private-test-1',
              name: 'Ho-khau-gia-dinh',
              pages: [blob],
              createdAt: Date.now()
            });
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
          };
          req.onerror = () => reject(req.error);
        });
      })()
    `, { awaitPromise: true })

    // Clear any previous guest quota in localStorage to start clean
    await evalInPage(cdp, `
      localStorage.removeItem('scanner_guest_scans_used');
      localStorage.removeItem('sb-scanner-mock-auth-token');
    `)

    // Reload page to ensure initial IndexedDB load
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


    // -------------------------------------------------------------
    // SCENARIO 1: Guest Mode Initial State (Còn 5/5 lượt thử)
    // -------------------------------------------------------------
    console.log('[4/7] Testing Guest Mode Initial State...')
    await sleep(300)
    const guestBadge = await evalInPage(cdp, `
      const badge = document.querySelector('button[title*="Lượt quét còn lại"], button:has(.lucide-sparkles), button:has(.lucide-user)');
      return {
        text: document.body.innerText.includes('Còn 5/5 lượt thử'),
        hasShutter: Boolean(document.querySelector('button[aria-label="Chụp tài liệu"]'))
      }
    `)
    console.log('  Guest initial check:', guestBadge)
    if (!guestBadge.text) throw new Error('QuotaBadge did not display "Còn 5/5 lượt thử" for initial guest')

    // Evidence 1: Camera screen with guest quota badge
    const ss1 = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const ss1Path = path.join(EVIDENCE_DIR, '01-guest-camera-quota-badge.png')
    fs.writeFileSync(ss1Path, Buffer.from(ss1.data, 'base64'))
    console.log(`  Saved screenshot: ${ss1Path}`)

    // -------------------------------------------------------------
    // SCENARIO 2: Open AuthModal (Sign In mode)
    // -------------------------------------------------------------
    console.log('  Testing AuthModal Sign In...')
    await evalInPage(cdp, `
      // Click user button or quota badge
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('lượt thử') || b.querySelector('.lucide-user'));
      if (btn) btn.click();
    `)
    await sleep(400)

    const authModalCheck = await evalInPage(cdp, `
      const dialog = document.querySelector('[role="dialog"]');
      return {
        isOpen: Boolean(dialog),
        title: dialog?.querySelector('h2')?.textContent,
        hasEmailInput: Boolean(dialog?.querySelector('input[type="email"]')),
        hasPasswordInput: Boolean(dialog?.querySelector('input[type="password"]')),
        hasPrivacyBadge: dialog?.textContent.includes('Hình ảnh tài liệu scan luôn lưu bảo mật trên máy bạn')
      }
    `)
    console.log('  AuthModal Sign In check:', authModalCheck)
    if (!authModalCheck.isOpen || !authModalCheck.hasEmailInput) {
      throw new Error('AuthModal did not open with expected email/password fields')
    }

    // Evidence 2: AuthModal in Sign In mode
    const ss2 = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const ss2Path = path.join(EVIDENCE_DIR, '02-auth-modal-signin.png')
    fs.writeFileSync(ss2Path, Buffer.from(ss2.data, 'base64'))
    console.log(`  Saved screenshot: ${ss2Path}`)

    // -------------------------------------------------------------
    // SCENARIO 3: Switch to AuthModal Sign Up tab
    // -------------------------------------------------------------
    console.log('  Testing AuthModal Sign Up tab...')
    await evalInPage(cdp, `
      const signUpTab = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Đăng ký (+20 lượt)'));
      if (signUpTab) signUpTab.click();
    `)
    await sleep(300)

    const signUpCheck = await evalInPage(cdp, `
      const dialog = document.querySelector('[role="dialog"]');
      return {
        title: dialog?.querySelector('h2')?.textContent,
        subtitle: dialog?.textContent.includes('Nhận ngay 20 lượt quét tài liệu miễn phí'),
        buttonText: dialog?.querySelector('button[type="submit"]')?.textContent
      }
    `)
    console.log('  AuthModal Sign Up check:', signUpCheck)
    if (!signUpCheck.title?.includes('Tạo tài khoản')) {
      throw new Error(`Expected title 'Tạo tài khoản', got: ${signUpCheck.title}`)
    }

    // Evidence 3: AuthModal in Sign Up mode
    const ss3 = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const ss3Path = path.join(EVIDENCE_DIR, '03-auth-modal-signup.png')
    fs.writeFileSync(ss3Path, Buffer.from(ss3.data, 'base64'))
    console.log(`  Saved screenshot: ${ss3Path}`)

    // Close AuthModal
    await evalInPage(cdp, `
      const closeBtn = document.querySelector('[role="dialog"] button[aria-label="Đóng"]');
      if (closeBtn) closeBtn.click();
    `)
    await sleep(300)

    // -------------------------------------------------------------
    // SCENARIO 4: Guest Quota Exhaustion (5/5 scans used)
    // -------------------------------------------------------------
    console.log('[5/7] Testing Guest Quota Exhaustion...')
    // Exhaust guest scans via localStorage and trigger re-render
    await evalInPage(cdp, `
      localStorage.setItem('scanner_guest_scans_used', '5');
      location.reload();
    `)
    await sleep(800)

    // Wait for reload
    for (let i = 0; i < 40; i++) {
      await sleep(200)
      const r = await evalInPage(cdp, `Boolean(document.querySelector('button[aria-label="Chụp tài liệu"]'))`)
      if (r) break
    }

    const exhaustedCheck = await evalInPage(cdp, `
      const shutter = document.querySelector('button[aria-label="Chụp tài liệu"]');
      return {
        badgeText: document.body.innerText.includes('Còn 0/5 lượt thử'),
        statusText: document.body.innerText.includes('Đã hết lượt quét - Nhấn để nhận thêm'),
        shutterButtonHasRoseRing: Boolean(shutter && shutter.className.includes('border-rose-400'))
      }
    `)
    console.log('  Exhausted guest check:', exhaustedCheck)
    if (!exhaustedCheck.badgeText) throw new Error('Badge text did not show "Còn 0/5 lượt thử"')

    // Evidence 4: Camera with exhausted quota and red capture ring
    const ss4 = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const ss4Path = path.join(EVIDENCE_DIR, '04-guest-quota-exhausted-camera.png')
    fs.writeFileSync(ss4Path, Buffer.from(ss4.data, 'base64'))
    console.log(`  Saved screenshot: ${ss4Path}`)

    // -------------------------------------------------------------
    // SCENARIO 5: Quota Exceeded Modal triggered on capture click
    // -------------------------------------------------------------
    console.log('  Testing QuotaExceededModal when capture clicked at 0 quota...')
    await evalInPage(cdp, `
      const shutter = document.querySelector('button[aria-label="Chụp tài liệu"]');
      if (shutter) shutter.click();
    `)
    await sleep(400)

    const quotaExceededCheck = await evalInPage(cdp, `
      const dialog = document.querySelector('[role="dialog"]');
      return {
        isOpen: Boolean(dialog),
        title: dialog?.querySelector('h3')?.textContent,
        hasSignupCta: Boolean(Array.from(dialog?.querySelectorAll('button') || []).find(b => b.textContent.includes('Đăng ký nhận 20 lượt'))),
        hasSigninCta: Boolean(Array.from(dialog?.querySelectorAll('button') || []).find(b => b.textContent.includes('Đăng nhập'))),
        hasPrivacyNote: dialog?.textContent.includes('Dữ liệu scan của bạn luôn an toàn trên máy')
      }
    `)
    console.log('  QuotaExceededModal check:', quotaExceededCheck)
    if (!quotaExceededCheck.isOpen || !quotaExceededCheck.title?.includes('Hết lượt quét thử')) {
      throw new Error('QuotaExceededModal did not open with expected title')
    }

    // Evidence 5: QuotaExceededModal dialog
    const ss5 = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const ss5Path = path.join(EVIDENCE_DIR, '05-quota-exceeded-modal.png')
    fs.writeFileSync(ss5Path, Buffer.from(ss5.data, 'base64'))
    console.log(`  Saved screenshot: ${ss5Path}`)

    // Close QuotaExceededModal
    await evalInPage(cdp, `
      const closeBtn = document.querySelector('[role="dialog"] button[aria-label="Đóng"]');
      if (closeBtn) closeBtn.click();
    `)
    await sleep(300)

    // -------------------------------------------------------------
    // SCENARIO 6: Authenticated User Experience & Quota Synchronization
    // -------------------------------------------------------------
    console.log('[6/7] Testing Authenticated User Experience...')
    // Open AuthModal via the User button ("Đăng nhập")
    await evalInPage(cdp, `
      const userBtn = document.querySelector('button[aria-label="Đăng nhập"]') ||
                      document.querySelector('button[aria-label="Thông tin lượt quét"]');
      if (userBtn) userBtn.click();
    `)
    await sleep(500)

    // Fill in credentials using React input value setter and click submit button
    await evalInPage(cdp, `
      const emailInput = document.querySelector('[role="dialog"] input[type="email"]');
      const passInput = document.querySelector('[role="dialog"] input[type="password"]');
      const submitBtn = document.querySelector('[role="dialog"] button[type="submit"]');

      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(emailInput, 'thanh.nguyen@scanner.app');
      emailInput.dispatchEvent(new Event('input', { bubbles: true }));

      setter.call(passInput, 'ScannerPass123!');
      passInput.dispatchEvent(new Event('input', { bubbles: true }));

      submitBtn.click();
    `)
    await sleep(1500)


    // Verify authenticated badge displays "Còn 18/20 lượt"
    const userBadgeCheck = await evalInPage(cdp, `
      return {
        badgeText: document.body.innerText.includes('Còn 18/20 lượt'),
        hasUserAvatar: Boolean(Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'T'))
      }
    `)
    console.log('  Authenticated user check:', userBadgeCheck)
    if (!userBadgeCheck.badgeText) {
      throw new Error('User QuotaBadge did not update to "Còn 18/20 lượt" after login')
    }

    // Evidence 6: Authenticated camera screen with user quota badge & avatar
    const ss6 = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const ss6Path = path.join(EVIDENCE_DIR, '06-authenticated-user-badge.png')
    fs.writeFileSync(ss6Path, Buffer.from(ss6.data, 'base64'))
    console.log(`  Saved screenshot: ${ss6Path}`)

    // -------------------------------------------------------------
    // SCENARIO 7: UserAccountModal Details & Privacy Notice
    // -------------------------------------------------------------
    console.log('  Testing UserAccountModal...')
    await evalInPage(cdp, `
      const avatarBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'T' || b.textContent.includes('Còn 18/20 lượt'));
      if (avatarBtn) avatarBtn.click();
    `)
    await sleep(400)

    const accountModalCheck = await evalInPage(cdp, `
      const dialog = document.querySelector('[role="dialog"]');
      return {
        isOpen: Boolean(dialog),
        email: dialog?.textContent.includes('thanh.nguyen@scanner.app'),
        hasMemberTag: dialog?.textContent.includes('Thành viên'),
        hasQuotaProgress: dialog?.textContent.includes('Đã dùng: 2') && dialog?.textContent.includes('/20 lượt còn lại'),
        hasLocalStoragePrivacy: dialog?.textContent.includes('IndexedDB') && dialog?.textContent.includes('Quyền riêng tư tuyệt đối'),
        hasSyncBtn: dialog?.textContent.includes('Đồng bộ'),
        hasSignOutBtn: dialog?.textContent.includes('Đăng xuất')
      }
    `)
    console.log('  UserAccountModal check:', accountModalCheck)
    if (!accountModalCheck.isOpen || !accountModalCheck.hasMemberTag || !accountModalCheck.hasLocalStoragePrivacy) {
      throw new Error('UserAccountModal did not display expected user info and privacy notice')
    }

    // Evidence 7: UserAccountModal with quota progress and privacy reassurance
    const ss7 = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const ss7Path = path.join(EVIDENCE_DIR, '07-user-account-modal.png')
    fs.writeFileSync(ss7Path, Buffer.from(ss7.data, 'base64'))
    console.log(`  Saved screenshot: ${ss7Path}`)

    // Close UserAccountModal
    await evalInPage(cdp, `
      const closeBtn = document.querySelector('[role="dialog"] button[aria-label="Đóng"]');
      if (closeBtn) closeBtn.click();
    `)
    await sleep(400)

    // -------------------------------------------------------------
    // SCENARIO 8: Perform a Scan & Consume 1 Scan from Quota
    // -------------------------------------------------------------
    console.log('[7/8] Testing Scan Capture & Quota Decrement from 18 to 17...')
    await evalInPage(cdp, `
      const shutter = document.querySelector('button[aria-label="Chụp tài liệu"]');
      if (shutter) shutter.click();
    `)
    await sleep(800)

    // In adjust screen: click "Áp dụng 4 góc & Cắt"
    await evalInPage(cdp, `
      const applyBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Áp dụng 4 góc'));
      if (applyBtn) applyBtn.click();
    `)
    await sleep(800)

    // In confirm screen: click "Xác nhận thêm"
    await evalInPage(cdp, `
      const confirmBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Xác nhận thêm'));
      if (confirmBtn) confirmBtn.click();
    `)
    await sleep(1000)

    // Wait for camera screen and updated quota badge
    let decremented = false
    let currentBodyText = ''
    for (let i = 0; i < 40; i++) {
      await sleep(200)
      currentBodyText = await evalInPage(cdp, `return document.body.innerText`)
      if (currentBodyText && currentBodyText.includes('Còn 17/20 lượt')) {
        decremented = true
        break
      }
    }
    console.log('  Decremented quota check:', { decremented, currentBodyTextSnippet: currentBodyText?.slice(0, 300) })


    if (!decremented) throw new Error('Quota badge did not decrement to "Còn 17/20 lượt" after scan')

    // Evidence 8: Camera screen with decremented quota badge
    const ss8 = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const ss8Path = path.join(EVIDENCE_DIR, '08-authenticated-scan-decremented.png')
    fs.writeFileSync(ss8Path, Buffer.from(ss8.data, 'base64'))
    console.log(`  Saved screenshot: ${ss8Path}`)

    // -------------------------------------------------------------
    // SCENARIO 9: Local Storage Integrity (IndexedDB documents remain private)
    // -------------------------------------------------------------
    console.log('[8/8] Testing Local IndexedDB Storage Integrity...')
    // Open Gallery
    await evalInPage(cdp, `
      const galleryBtn = document.querySelector('button[aria-label="Thư viện"]');
      if (galleryBtn) galleryBtn.click();
    `)
    await sleep(500)

    const galleryCheck = await evalInPage(cdp, `
      return {
        hasPrivateDoc: document.body.innerText.includes('Ho-khau-gia-dinh'),
        title: document.querySelector('h1')?.textContent || document.body.innerText.includes('Thư viện tài liệu')
      }
    `)
    console.log('  Gallery check:', galleryCheck)
    if (!galleryCheck.hasPrivateDoc) {
      throw new Error('Gallery did not load document from local IndexedDB')
    }

    // Evidence 9: Gallery view confirming local IndexedDB storage
    const ss9 = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const ss9Path = path.join(EVIDENCE_DIR, '09-local-gallery-indexeddb.png')
    fs.writeFileSync(ss9Path, Buffer.from(ss9.data, 'base64'))
    console.log(`  Saved screenshot: ${ss9Path}`)

    console.log('\n--- All E2E Auth & Quota checks passed successfully! ---')
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
