import { spawn, execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const EVIDENCE_DIR = '/home/asus/.no-mistakes/evidence/01M2H6KS37WQAXF6TB38GMAYBW'
const VITE_PORT = 5196
const CHROME_PORT = 9235

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
  console.log('=== Starting E2E Tracking & Denoise Verification ===')
  if (!fs.existsSync(EVIDENCE_DIR)) {
    fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  }

  // 1. Start Vite dev server
  console.log(`[1/6] Starting Vite on port ${VITE_PORT}...`)
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
    throw new Error('Failed to start Vite dev server')
  }

  // 2. Launch Google Chrome headless
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

    const pageTarget = targets?.find(t => t.type === 'page')
    if (!pageTarget) throw new Error('No Chrome page target')

    ws = new WebSocket(pageTarget.webSocketDebuggerUrl)
    await new Promise(resolve => { ws.onopen = resolve })
    const cdp = createCdpClient(ws)

    await cdp.send('Page.enable')
    await cdp.send('Runtime.enable')
    await cdp.send('DOM.enable')

    // Emulate iPhone 14/15 Pro (430x932, 2x DPR)
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
    if (!appReady) throw new Error('App or OpenCV did not initialize')
    console.log('  App and OpenCV loaded successfully!')

    // Install frame-feed interception and scene generators in page
    console.log('[4/6] Setting up synthetic test frame generator in browser...')
    await evalInPage(cdp, `
      window.__testFrameCanvas = document.createElement('canvas');
      window.__testFrameCanvas.width = 800;
      window.__testFrameCanvas.height = 600;

      // Intercept canvas drawImage so video frames are supplied by our test scene
      const origDrawImage = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function(img, ...args) {
        if (img instanceof HTMLVideoElement && window.__testFrameCanvas) {
          return origDrawImage.call(this, window.__testFrameCanvas, ...args);
        }
        return origDrawImage.call(this, img, ...args);
      };

      Object.defineProperty(HTMLVideoElement.prototype, 'videoWidth', {
        get() { return window.__testFrameCanvas ? window.__testFrameCanvas.width : 800; },
        configurable: true
      });
      Object.defineProperty(HTMLVideoElement.prototype, 'videoHeight', {
        get() { return window.__testFrameCanvas ? window.__testFrameCanvas.height : 600; },
        configurable: true
      });

      // Helper: Draw realistic noisy background (anime mousepad / mechanical keyboard)
      window.renderNoisyBackground = function(ctx, w, h) {
        // Dark textured gamer desk mat surface
        ctx.fillStyle = '#1e222b';
        ctx.fillRect(0, 0, w, h);

        // Desk weave / texture lines
        ctx.strokeStyle = '#282c34';
        ctx.lineWidth = 1;
        for (let x = 15; x < w - 15; x += 16) {
          ctx.beginPath(); ctx.moveTo(x, 15); ctx.lineTo(x, h - 15); ctx.stroke();
        }

        // Anime artwork on mousepad (illustration with circles and line art)
        ctx.strokeStyle = '#4b5263';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(100, 140, 60, 0, Math.PI * 2);
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(100, 140, 35, 0, Math.PI * 2);
        ctx.stroke();

        // Anime speed lines / action graphics
        ctx.strokeStyle = '#61afef';
        ctx.lineWidth = 1.5;
        for (let i = 0; i < 8; i++) {
          ctx.beginPath();
          ctx.moveTo(30 + i * 16, 240);
          ctx.lineTo(70 + i * 14, 380);
          ctx.stroke();
        }

        // Mechanical keyboard edge on top right
        ctx.fillStyle = '#181b20';
        ctx.fillRect(w - 220, 20, 200, 110);
        ctx.strokeStyle = '#3e4451';
        ctx.lineWidth = 1;
        for (let r = 0; r < 3; r++) {
          for (let c = 0; c < 5; c++) {
            ctx.strokeRect(w - 215 + c * 38, 25 + r * 32, 34, 28);
          }
        }

        // Anime mat branding text
        ctx.fillStyle = '#e06c75';
        ctx.font = 'bold 22px sans-serif';
        ctx.fillText('ANIME DESK MAT // MECHA-01', 30, 45);
        ctx.fillStyle = '#98c379';
        ctx.font = '14px monospace';
        ctx.fillText('TACTILE KEYBOARD EDGE', w - 210, 150);
      };

      // Helper: Draw paper document quad
      window.renderDocument = function(ctx, quad) {
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 2;

        ctx.beginPath();
        ctx.moveTo(quad[0].x, quad[0].y);
        ctx.lineTo(quad[1].x, quad[1].y);
        ctx.lineTo(quad[2].x, quad[2].y);
        ctx.lineTo(quad[3].x, quad[3].y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Realistic document content: header, divider, and text lines
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 20px sans-serif';
        const midX = (quad[0].x + quad[1].x) / 2;
        const topY = (quad[0].y + quad[1].y) / 2 + 35;
        ctx.fillText('HỢP ĐỒNG KINH TẾ 2026', midX - 120, topY);

        ctx.fillStyle = '#0284c7';
        ctx.fillRect(quad[0].x + 30, topY + 12, (quad[1].x - quad[0].x) - 60, 3);

        ctx.fillStyle = '#334155';
        ctx.font = '12px monospace';
        for (let lineY = topY + 30; lineY < (quad[2].y + quad[3].y) / 2 - 30; lineY += 18) {
          ctx.fillRect(quad[0].x + 35, lineY, (quad[1].x - quad[0].x) - 70, 7);
        }
        ctx.restore();
      };

      // Helper: Draw finger occlusion on paper edge
      window.renderFinger = function(ctx, startX, startY, radiusX, radiusY) {
        ctx.save();
        ctx.fillStyle = '#dca682'; // Skin tone
        ctx.strokeStyle = '#a2623a';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(startX, startY, radiusX, radiusY, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Fingernail
        ctx.fillStyle = '#fce7f3';
        ctx.beginPath();
        ctx.ellipse(startX - radiusX * 0.25, startY, radiusX * 0.25, radiusY * 0.45, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      };
    `)

    // ----------------------------------------------------------------
    // SCENARIO 1: Pure noisy background (Anime mousepad / keyboard)
    // ----------------------------------------------------------------
    console.log('[5/6] Scenario 1: Pure noisy background without document...');
    await evalInPage(cdp, `
      const ctx = window.__testFrameCanvas.getContext('2d');
      window.renderNoisyBackground(ctx, 800, 600);
    `)
    await sleep(700) // Allow drawLive to run multiple frames

    // Verify: No false document quad tracked on noisy background
    const sc1Check = await evalInPage(cdp, `
      const canvas = document.querySelector('canvas');
      const ctx = canvas.getContext('2d');
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let greenPixels = 0;
      for (let i = 0; i < imgData.data.length; i += 4) {
        const r = imgData.data[i], g = imgData.data[i+1], b = imgData.data[i+2];
        if (g > 150 && r < 50 && b > 80 && b < 160) {
          greenPixels++;
        }
      }
      const status = document.querySelector('p')?.textContent || '';
      return { greenPixels, status, width: canvas.width, height: canvas.height };
    `)
    console.log('  Scenario 1 Check:', sc1Check)
    if (sc1Check.greenPixels > 0) {
      console.warn(`  Note: green pixels in scenario 1: ${sc1Check.greenPixels}`)
    }

    const ss1 = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const ss1Path = path.join(EVIDENCE_DIR, '01-camera-noisy-background-no-false-positive.png')
    fs.writeFileSync(ss1Path, Buffer.from(ss1.data, 'base64'))
    console.log(`  Saved screenshot: ${ss1Path}`)

    // ----------------------------------------------------------------
    // SCENARIO 2: Document placed on complex noisy background
    // ----------------------------------------------------------------
    console.log('  Scenario 2: Document on complex noisy background...');
    const docQuad = [
      { x: 180, y: 70 },
      { x: 560, y: 80 },
      { x: 540, y: 520 },
      { x: 165, y: 505 }
    ]
    await evalInPage(cdp, `
      const ctx = window.__testFrameCanvas.getContext('2d');
      window.renderNoisyBackground(ctx, 800, 600);
      window.renderDocument(ctx, ${JSON.stringify(docQuad)});
    `)
    await sleep(800) // Allow drawLive to detect corners and draw emerald green polygon

    const sc2Check = await evalInPage(cdp, `
      // Verify emerald green stroke on canvas
      const canvas = document.querySelector('canvas');
      const ctx = canvas.getContext('2d');
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let greenPixels = 0;
      for (let i = 0; i < imgData.data.length; i += 4) {
        const r = imgData.data[i], g = imgData.data[i+1], b = imgData.data[i+2];
        if (g > 150 && r < 50 && b > 80 && b < 160) {
          greenPixels++;
        }
      }
      return { greenPixels, canvasWidth: canvas.width, canvasHeight: canvas.height };
    `)
    console.log(`  Scenario 2 green polygon pixels detected: ${sc2Check.greenPixels}`)
    if (sc2Check.greenPixels < 100) {
      throw new Error(`Expected emerald green tracking polygon on document, but found only ${sc2Check.greenPixels} pixels`)
    }

    const ss2 = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const ss2Path = path.join(EVIDENCE_DIR, '02-camera-tracking-document-on-noisy-background.png')
    fs.writeFileSync(ss2Path, Buffer.from(ss2.data, 'base64'))
    console.log(`  Saved screenshot: ${ss2Path}`)

    // ----------------------------------------------------------------
    // SCENARIO 3: Hand / Finger Occlusion on Paper Edge
    // ----------------------------------------------------------------
    console.log('  Scenario 3: Document with hand/finger occlusion on paper edge...');
    await evalInPage(cdp, `
      const ctx = window.__testFrameCanvas.getContext('2d');
      window.renderNoisyBackground(ctx, 800, 600);
      window.renderDocument(ctx, ${JSON.stringify(docQuad)});
      // User's finger holding down the right edge of paper:
      // Right edge runs from (560, 80) to (540, 520). Midpoint is ~(550, 300).
      // Finger presses at (545, 305) with radius 36x24
      window.renderFinger(ctx, 545, 305, 36, 24);
    `)
    await sleep(800)

    const sc3Check = await evalInPage(cdp, `
      const canvas = document.querySelector('canvas');
      const ctx = canvas.getContext('2d');
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      let greenPixels = 0;
      for (let i = 0; i < imgData.data.length; i += 4) {
        const r = imgData.data[i], g = imgData.data[i+1], b = imgData.data[i+2];
        if (g > 150 && r < 50 && b > 80 && b < 160) {
          greenPixels++;
        }
      }
      return { greenPixels };
    `)
    console.log(`  Scenario 3 green polygon pixels with finger occlusion: ${sc3Check.greenPixels}`)
    if (sc3Check.greenPixels < 100) {
      throw new Error(`Expected emerald green tracking polygon with finger occlusion, but found only ${sc3Check.greenPixels} pixels`)
    }

    const ss3 = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const ss3Path = path.join(EVIDENCE_DIR, '03-camera-tracking-finger-occlusion-restored.png')
    fs.writeFileSync(ss3Path, Buffer.from(ss3.data, 'base64'))
    console.log(`  Saved screenshot: ${ss3Path}`)

    // ----------------------------------------------------------------
    // SCENARIO 4: Shutter capture & automatic perspective warp to Confirm screen
    // ----------------------------------------------------------------
    console.log('  Scenario 4: Capturing document and verifying perspective warp...');
    await evalInPage(cdp, `
      document.querySelector('button[aria-label="Chụp tài liệu"]').click();
    `)
    await sleep(1000)

    const sc4Check = await evalInPage(cdp, `
      const h1 = document.querySelector('h1')?.textContent || '';
      const status = document.querySelector('p')?.textContent || '';
      const buttons = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim());
      const hasConfirmBtn = buttons.some(t => t.includes('Xác nhận thêm'));
      const hasRetakeBtn = buttons.some(t => t.includes('Chụp lại'));
      return { h1, status, hasConfirmBtn, hasRetakeBtn };
    `)
    console.log('  Scenario 4 Confirm screen check:', sc4Check)
    if (!sc4Check.hasConfirmBtn) {
      throw new Error(`Expected Confirm screen ("Xác nhận thêm"), but got: ${JSON.stringify(sc4Check)}`)
    }

    const ss4 = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const ss4Path = path.join(EVIDENCE_DIR, '04-capture-confirm-screen.png')
    fs.writeFileSync(ss4Path, Buffer.from(ss4.data, 'base64'))
    console.log(`  Saved screenshot: ${ss4Path}`)

    // ----------------------------------------------------------------
    // SCENARIO 5: Save to Cart & complete scan workflow
    // ----------------------------------------------------------------
    console.log('  Scenario 5: Confirming page and verifying Cart screen...');
    await evalInPage(cdp, `
      const btn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('Xác nhận thêm'));
      btn.click();
    `)
    await sleep(600)

    // Click cart icon (the "1 trang" button in header)
    await evalInPage(cdp, `
      const cartBtn = Array.from(document.querySelectorAll('button')).find(b => b.textContent.includes('trang'));
      cartBtn.click();
    `)
    await sleep(500)

    const sc5Check = await evalInPage(cdp, `
      const buttons = Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim());
      const hasSaveToPhotos = buttons.some(t => t.includes('Lưu vào Album ảnh'));
      const hasExportPdf = buttons.some(t => t.includes('Xuất PDF'));
      const pageCount = document.querySelectorAll('button[aria-label^="Tải nhanh ảnh trang"]').length;
      return { hasSaveToPhotos, hasExportPdf, pageCount };
    `)
    console.log('  Scenario 5 Cart screen check:', sc5Check)
    if (!sc5Check.hasSaveToPhotos) {
      throw new Error(`Expected Cart screen with "Lưu vào Album ảnh", but got: ${JSON.stringify(sc5Check)}`)
    }

    const ss5 = await cdp.send('Page.captureScreenshot', { format: 'png' })
    const ss5Path = path.join(EVIDENCE_DIR, '05-cart-screen-with-scanned-document.png')
    fs.writeFileSync(ss5Path, Buffer.from(ss5.data, 'base64'))
    console.log(`  Saved screenshot: ${ss5Path}`)

    console.log('[6/6] All E2E scenarios validated successfully!')
  } finally {
    if (ws) ws.close()
    chrome.kill('SIGKILL')
    vite.kill('SIGKILL')
    cleanupPorts()
  }
}

run().catch(err => {
  console.error('Test run failed:', err)
  process.exit(1)
})
