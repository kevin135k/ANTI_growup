# 兒童生長曲線與預測身高｜門診快速評估 PWA

專為兒科門診快速操作與家長閱讀設計的漸進式網頁應用程式（PWA），採用日本傳統色 [NIPPON COLORS「長春 CYOHSYUN」(`#BF6766`)](https://nipponcolors.com/#cyohsyun) 搭配「藍鼠 (`#5D7A8C`)」與胡粉暖紙底色 (`#F6F2EE`) 等低彩度柔和色系，避免刺眼高飽和色彩。

## 主要功能

- **預設首頁｜預測身高與生長評估**
  - 一鍵快速切換男／女性別（同步柔和調整主題點綴色）
  - **雙模式生日輸入**：除原生年曆選單外，支援純數字鍵盤直接輸入西元 8 碼（如 `20180512`）、民國 7 碼（如 `1070512`）或分隔格式，即時換算年齡與早產兒矯正年齡
  - **成年預測身高**：
    - 遺傳目標身高（Mid-Parental Height，含 `± 5 cm` 與 `± 7.5 cm` 區間）
    - 目前生長曲線軌道推估 18 歲成年身高
    - 進階 **骨齡預測成年身高**（Bayley-Pinneau 比例法 + 台灣骨齡曲線推估）
  - **即時體位評估**：身高／體重／頭圍（0–5 歲）精確百分位（PR）與 Z-score、衛福部兒童青少年 BMI 判讀，搭配互動式 SVG 生長曲線圖（身高／體重切換）與一鍵複製門診摘要
- **左上角漢堡選單**
  - **快速 `−`／`+` 介面與字體縮放（85%–130%）**：自動記憶於瀏覽器，讓 iPhone 單手操作與 iPad 診間向家長說明皆清晰順手
  - **新生兒 SGA / 胎齡評估**：依據台灣單胞胎（Hsieh et al., 2006）與雙胞胎（Hu et al., 2015）懷孕週數出生體重百分位表判讀 SGA / AGA / LGA
  - **兒童發展評估篩檢（0–6 歲）**：依月齡區間涵蓋粗動作、精細動作、語言溝通與社會互動，支援快速預填正常值
  - **台灣身高體重與 BMI 對照表**：完整 0–18 歲百分位表（含年級）與 0–17.5 歲衛福部 BMI 建議值，自動高亮目前年齡列
  - **兒科門診速查參考**：依年齡自動切換睡眠時間、熱量需求、發牙時程與正常生命徵候

## 資料來源與參考文獻

1. 衛生福利部國民健康署《兒童生長曲線摺頁之圖表原檔》（WHO 0–5 歲標準）與《兒童及青少年生長身體質量指數（BMI）建議值》（102 年 6 月 11 日公布）
2. Chen W, Chang MH. *New growth charts for Taiwanese children and adolescents based on World Health Organization standards and health-related physical fitness.* Pediatr Neonatol. 2010;51(2):69–79.
3. Hsieh WS et al. *Nationwide singleton birth weight percentiles by gestational age in Taiwan, 1998–2002.* Acta Paediatr Taiwan. 2006;47(4):174–180.
4. Hu IJ et al. *Nationwide twin birth weight percentiles by gestational age in Taiwan.* J Chin Med Assoc. 2015;78(1):57–64.

## 本機預覽

本專案為純靜態 HTML/CSS/ES Module PWA，無須建置步驟，可使用任何靜態伺服器啟動：

```bash
python3 -m http.server 8080
```
