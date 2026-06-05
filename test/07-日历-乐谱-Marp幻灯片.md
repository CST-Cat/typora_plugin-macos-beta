# 第三方组件测试：calendar / abc / marp

## Calendar

```calendar
// ==BlockCodeConfig==
// @height           520px
// @backgroundColor  transparent
// ==/BlockCodeConfig==

const today = new Date()
const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)

option = { defaultView: 'week' }
calendar.createEvents([
  { id: 'event1', calendarId: 'cal1', title: '测试标签页布局', start: today, end: tomorrow },
  { id: 'event2', calendarId: 'cal1', title: '检查 helper 日志', start: tomorrow, end: tomorrow },
])
```

## ABC 乐谱

```abc
X:1
T:Plugin Smoke Test
M:4/4
L:1/4
K:C
C D E F|G A B c|c B A G|F E D C||
```

## Marp

```marp
---
theme: gaia
paginate: true
backgroundColor: #FFFFFF
---

# Typora Plugin

macOS smoke test

---

## Checklist

- window_tab
- command_palette
- preferences
- helper RPC
```
