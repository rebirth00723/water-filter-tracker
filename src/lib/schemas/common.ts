import { z } from 'zod'

/**
 * 共用的欄位型別。
 *
 * 核心問題是**「空」有三種寫法而資料庫只認一種**：HTML 表單送出空字串，
 * JSON 送 null，沒填的欄位是 undefined。全部要在進資料庫前收斂成 `null`，
 * 否則 `model = ''` 與 `model = null` 會在畫面上長成兩種樣子（一個空白、一個「—」）。
 *
 * 數字欄位刻意以**字串為輸入型別**而不用 `z.coerce`。理由是型別精確度：
 * `z.coerce.number()` 的 input 型別是 `unknown`，會讓 react-hook-form 的
 * 欄位型別整個鬆掉。而這個 App 的唯一客戶端就是 HTML 表單，輸入一定是字串 ——
 * 照實宣告就能拿到精確的型別，不必為了假想的 JSON 客戶端犧牲它。
 */

/** 選填文字：空字串一律變成 null。trim 必須在 max 之前，否則前後空白會吃掉字數上限 */
export function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, `不能超過 ${max} 個字`)
    .transform((v) => (v === '' ? null : v))
}

/** 必填文字 */
export function requiredText(max: number, label: string) {
  return z.string().trim().min(1, `請填寫${label}`).max(max, `${label}不能超過 ${max} 個字`)
}

/**
 * 選填日期（YYYY-MM-DD）。`z.iso.date()` 連 2026-02-31 都會擋掉 ——
 * 它驗的是真實日期而不只是格式，所以不需要另外檢查。
 */
export const optionalDate = z
  .union([z.literal(''), z.iso.date('日期格式不正確')])
  .transform((v) => (v === '' ? null : v))

/** 必填日期 */
export const requiredDate = z.iso.date('請選擇日期')

/** 資料庫主鍵。由程式傳入而非表單欄位，所以用 coerce 容錯 */
export const dbId = z.coerce.number().int().positive('id 不正確')

/** 選填的正整數：空字串代表「不設」而不是 0 */
export function optionalPositiveInt(max: number, label: string) {
  return z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : Number(v)))
    .refine((v) => v === null || Number.isInteger(v), `${label}必須是整數`)
    .refine((v) => v === null || v >= 1, `${label}至少為 1`)
    .refine((v) => v === null || v <= max, `${label}最多為 ${max}`)
}

/**
 * 必填的非負整數。PPM 用這個而不是 positiveInt ——
 * 純水的 TDS 讀數**可以是 0**（好的 RO 膜配上新的後置濾心就會是 0），
 * 把下限設成 1 會讓最理想的那個讀數填不進去。
 */
export function nonNegativeInt(max: number, label: string) {
  return z
    .string()
    .trim()
    .min(1, `請填寫${label}`)
    .transform((v) => Number(v))
    .refine((v) => Number.isInteger(v), `${label}必須是整數`)
    .refine((v) => v >= 0, `${label}不能是負數`)
    .refine((v) => v <= max, `${label}最多為 ${max}`)
}

/** 必填正整數 */
export function positiveInt(max: number, label: string) {
  return z
    .string()
    .trim()
    .min(1, `請填寫${label}`)
    .transform((v) => Number(v))
    .refine((v) => Number.isInteger(v), `${label}必須是整數`)
    .refine((v) => v >= 1, `${label}至少為 1`)
    .refine((v) => v <= max, `${label}最多為 ${max}`)
}

/** 選填的非負整數（PPM、單價）：空字串代表「沒填」而不是 0 */
export function optionalNonNegativeInt(max: number, label: string) {
  return z
    .string()
    .trim()
    .transform((v) => (v === '' ? null : Number(v)))
    .refine((v) => v === null || Number.isInteger(v), `${label}必須是整數`)
    .refine((v) => v === null || v >= 0, `${label}不能是負數`)
    .refine((v) => v === null || v <= max, `${label}最多為 ${max}`)
}

/**
 * 十六進位色碼。限制成 `#rrggbb` 而不接受簡寫或色彩名稱 ——
 * 這個值會直接送進 ECharts 的 itemStyle 與 inline style，
 * 格式統一才不必在每個消費端各寫一次正規化。
 */
export const hexColor = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, '請使用 #rrggbb 格式的色碼')
  .transform((v) => v.toLowerCase())
