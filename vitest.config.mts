import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

/**
 * vitest 需要自己知道 `@/` 別名 —— 它不讀 tsconfig 的 paths。
 * 沒有這一段的話，任何從 src/ 匯入其他模組的測試都會在解析時就掛掉，
 * 而錯誤訊息（Cannot find package '@/…'）看起來像套件沒安裝，很容易誤判。
 *
 * 注意：vitest 走 esbuild，**不做型別檢查**。
 * 「測試全過」不等於「型別正確」，兩者必須各跑一次。
 *
 * 副檔名是 `.mts` 而不是 `.ts`：這個 package 沒有 `"type": "module"`，
 * Vite 會把 `.ts` 當 CommonJS 載入然後對 ESM 語法發出警告。
 * 改 package.json 的 type 會牽動其他組態檔，換副檔名是影響面最小的解法。
 */
export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      // 見 test/server-only-shim.ts 的說明
      'server-only': fileURLToPath(new URL('./test/server-only-shim.ts', import.meta.url)),
    },
  },
  test: {
    include: ['src/**/*.test.ts'],
  },
})
