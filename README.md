# 🏀 Hoops

一個可以直接嵌入 Docusaurus 部落格文章的瀏覽器投籃小遊戲。

馬上玩：https://wiwi.blog/blog/hoops

---

## 玩法

**按住（空白鍵 / 滑鼠 / 觸控）→ 放開**，就投出去了。

時機點很重要。太早放、太晚放都會偏掉。

### 模式

| 模式 | 說明 |
|------|------|
| **限時模式** | 60 秒內盡量投，結束後顯示得分 |
| **練習模式** | 不限時，隨便投 |

標題畫面可以用鍵盤 `1` / `2` 選模式，或直接點按鈕。

### 鍵盤快捷鍵

| 按鍵 | 動作 |
|------|------|
| `Space` 按住 / 放開 | 蓄力 / 投籃 |
| `1` / `2` | 在標題畫面選模式 |
| `Esc` | 練習模式中回主畫面 |

---

## 遊戲機制

### 蓄力與投籃時機

按住後球會隨著一個 sine 曲線跳起來，快到頂點時有一個非常短暫的「完美時機窗口」（`PERFECT_WINDOW_T`，預設約 28% 的跳躍週期）。在這個窗口內放開，球幾乎會完美飛進。

偏離完美時機越多，球就會往偏斜方向飄去——偏早往一個方向飄，偏晚往另一個方向。偏移量由 `SHOT_DRIFT_VEL` 和 `SHOT_DRIFT_ANGLE` 控制。

即使在完美時機內放開，也有一點點微小的隨機浮動（`PERFECT_JITTER_VEL` / `PERFECT_JITTER_ANGLE`），所以每一球都不會完全一樣。

### 物理碰撞

- **籃框（rim）**：兩端各有一個圓形碰撞體，球打到會彈開（`RESTITUTION_RIM`）
- **籃板（backboard）**：從籃框後緣延伸出去，可以打板得分
- **連接臂**：rim 後緣到籃板之間的細臂，也有碰撞偵測
- **球與球**：多顆球同時在空中會互相彈開（`RESTITUTION_BALL`）

---

## 在 Docusaurus 裡使用

### 1. 把檔案放進去

將 `Hoops3.jsx` 複製到你的 Docusaurus 專案中，例如：

```
src/components/Hoops3.jsx
```

### 2. 在 MDX 文章裡引入

Docusaurus 的部落格文章支援 MDX，可以直接 import React component：

```mdx
---
title: 投籃遊戲
---

import Hoops from '@site/src/components/Hoops3';

<Hoops />
```

### 3. 自訂參數（選用）

可以透過 `config` prop 調整遊戲設定：

```mdx
<Hoops config={{
  GAME_DURATION: 30,
  PERFECT_TOLERANCE: 0.01,
}} />
```

所有可用的參數及預設值：

| 參數 | 預設值 | 說明 |
|------|--------|------|
| `GAME_DURATION` | `60` | 限時模式秒數 |
| `COOLDOWN` | `0.5` | 兩球之間的間隔（秒） |
| `JUMP_DURATION` | `0.5` | 跳躍動畫總時長（秒） |
| `JUMP_HEIGHT_RATIO` | `0.25` | 跳躍高度（相對畫面寬度） |
| `PERFECT_WINDOW_T` | `0.28` | 完美時機的位置（0~1，跳躍週期的幾成） |
| `PERFECT_TOLERANCE` | `0.001` | 完美時機的容許誤差（越大越好投） |
| `MAX_DRIFT_T` | `0.35` | 最大飄移對應的時機偏差 |
| `GRAVITY_RATIO` | `5` | 重力強度（相對畫面寬度） |
| `BALL_RADIUS_RATIO` | `0.03` | 球的大小（相對畫面寬度） |
| `RESTITUTION_RIM` | `0.75` | 籃框彈性係數 |
| `RESTITUTION_BOARD` | `0.75` | 籃板彈性係數 |
| `RESTITUTION_BALL` | `0.7` | 球與球碰撞彈性係數 |
| `SHOT_TARGET_TIME` | `0.75` | 球飛到籃框的目標時間（秒） |
| `SHOT_DRIFT_VEL` | `0.4` | 時機偏差造成的速度飄移量 |
| `SHOT_DRIFT_ANGLE` | `0.6` | 時機偏差造成的角度飄移量 |
| `BALL_IMG_SRC` | `null` | 自訂球的圖片 URL（不設就用預設橘球） |

---

## 作弊

程式在 `window.__hoops` 上掛了一個物件，讓你可以直接從 DevTools Console 竄改遊戲狀態。

**把 Perfect 容許範圍設到 999（基本上每球都完美）：**

```javascript
window.__hoops.CONFIG.PERFECT_TOLERANCE = 999
```

設完之後，不管什麼時候放開，都算完美時機。

---

## 注意事項

- 鍵盤監聽加了 IntersectionObserver：捲出畫面後空白鍵不會被遊戲吃掉，翻頁還是翻頁
- 觸控裝置用 `setPointerCapture` 處理，不會干擾頁面上的其他連結點擊
- Canvas 的 Console 會輸出每一球的時機資訊，方便 debug
