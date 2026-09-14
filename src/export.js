export const download = (blob, name) => {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Share or download JPEG images with Web Share API and download fallback.
 * Returns true if sharing or download succeeded, or false if the user canceled (AbortError).
 */
export async function shareOrDownloadImages(files, title = 'Tài liệu quét', downloadFn = download) {
  if (typeof navigator !== 'undefined' && navigator.canShare) {
    try {
      if (navigator.canShare({ files })) {
        await navigator.share({
          files,
          title,
        })
        return true
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        return false
      }
      console.warn('Web Share failed, falling back to download:', err)
    }
  }

  // Fallback: download each file
  for (let i = 0; i < files.length; i++) {
    downloadFn(files[i], files[i].name)
    if (files.length > 1) {
      await new Promise(resolve => setTimeout(resolve, 250))
    }
  }
  return true
}
