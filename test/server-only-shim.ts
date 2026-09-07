/**
 * `server-only` 的空殼，只給 vitest 用。
 *
 * Next 在建置時自己處理這個 specifier（官方文件說安裝該套件是可選的），
 * 它的作用是讓「Client Component 誤匯入伺服端模組」在建置階段就直接失敗，
 * 而不是產出一個把 better-sqlite3 打進瀏覽器 bundle 的壞結果。
 *
 * vitest 不認識它，所以在測試裡別名到這個空檔案。
 * 這不會削弱保護 —— 保護發生在 next build，測試只是需要能把模組載進來。
 */
export {}
