import { describe, expect, it, vi } from 'vitest'

/**
 * 這組測試釘住的是一個曾經真的發生、而且只有真實瀏覽器才抓得到的 bug：
 *
 * `new URL(path, req.url)` 在 Next standalone 下會把 req.url 解析成
 * `http://localhost:<PORT>`，**不管實際的 Host header 是什麼**。
 * 結果是部署在自己網域上時，登入成功會把瀏覽器導去 localhost；
 * 而在本機用 127.0.0.1 開頁面時，導向 localhost 算跨來源，
 * 會被 CSP 的 `form-action 'self'` 擋掉整個表單送出。
 *
 * curl 抓不到這個問題（它會跟著任何 Location、也不執行 CSP），所以用測試補上。
 */
describe('seeOther', () => {
  it('Location 是相對路徑，不含協定與主機', async () => {
    vi.resetModules()
    delete process.env.BASE_PATH
    const { seeOther } = await import('./http')

    const res = seeOther('/login?error=login_failed')
    expect(res.status).toBe(303)
    const loc = res.headers.get('location')!
    expect(loc).toBe('/login?error=login_failed')
    expect(loc).not.toMatch(/^https?:/)
    expect(loc).not.toContain('localhost')
  })
})

describe('withBasePath', () => {
  it('沒設 BASE_PATH 時原樣回傳', async () => {
    vi.resetModules()
    delete process.env.BASE_PATH
    const { withBasePath } = await import('./http')
    expect(withBasePath('/login')).toBe('/login')
    expect(withBasePath('/')).toBe('/')
  })

  it('設了 BASE_PATH 時補上前綴', async () => {
    vi.resetModules()
    process.env.BASE_PATH = '/water'
    const { withBasePath, seeOther } = await import('./http')
    expect(withBasePath('/login')).toBe('/water/login')
    expect(seeOther('/d/1').headers.get('location')).toBe('/water/d/1')
    delete process.env.BASE_PATH
  })

  it('BASE_PATH 的尾端斜線會被去掉，避免產生 //', async () => {
    vi.resetModules()
    process.env.BASE_PATH = '/water/'
    const { withBasePath } = await import('./http')
    expect(withBasePath('/login')).toBe('/water/login')
    delete process.env.BASE_PATH
  })
})
