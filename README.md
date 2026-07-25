# TOEIC 互動自學教材 Web 版

目前版本：v1.1 修正版

## 直接離線使用

雙擊：

`TOEIC自學教室_單檔版.html`

所有教材、題庫、樣式與功能都放在同一個 HTML 檔案內。

## 部署到 GitHub Pages

請把本資料夾內的檔案全部上傳到 GitHub Repository 的最外層，確保 Repository 首頁直接看得到：

- `index.html`
- `styles.css`
- `data.js`
- `app.js`

接著前往：

`Settings → Pages → Deploy from a branch → main → /(root) → Save`

不要只上傳 ZIP，也不要讓結構變成 `toeic-study-web/toeic-study-web/index.html`。

## 學習紀錄

進度使用瀏覽器 `localStorage` 儲存：

- 同一個網址、同一個瀏覽器會保留進度。
- 不同瀏覽器或不同裝置不會自動同步。
- 更新網站檔案通常不會刪除既有進度。
- 清除瀏覽器網站資料可能會清除進度。

## 檔案說明

- `index.html`：網站首頁與版面結構
- `styles.css`：視覺與手機版樣式
- `data.js`：22 個教材章節、85 題練習、40 張單字卡
- `app.js`：進度、練習、錯題本、搜尋與單字卡功能
- `TOEIC自學教室_單檔版.html`：可直接離線開啟的單檔版
- `REVIEW_LOG.md`：本次完整檢查及修正紀錄
- `sources/`：原始教材資料
## UX 快捷入口更新

首頁進度圓環旁的兩張提示卡已改為可操作按鈕：

- `開始學習`：直接開啟 Part 5「詞性秒判」章節。
- `立即作答`：直接開始 10 題混合練習，作答後立即顯示解析。

按鈕支援滑鼠 hover、鍵盤焦點與 Enter／Space 操作。

