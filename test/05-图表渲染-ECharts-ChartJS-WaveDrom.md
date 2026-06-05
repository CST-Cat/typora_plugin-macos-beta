# 图表插件测试：echarts / chart / wavedrom

## ECharts

```echarts
// ==BlockCodeConfig==
// @locale           zh
// @theme            light
// @renderer         svg
// @height           320px
// @backgroundColor  transparent
// ==/BlockCodeConfig==

option = {
  title: { text: '插件加载状态' },
  tooltip: {},
  xAxis: { data: ['loader', 'bundle', 'helper', 'tabs', 'menu'] },
  yAxis: {},
  series: [{ type: 'bar', data: [1, 1, 1, 1, 1] }]
}
```

## Chart.js

```chart
// ==BlockCodeConfig==
// @align            center
// @height           300px
// @backgroundColor  transparent
// ==/BlockCodeConfig==

config = {
  type: "line",
  data: {
    labels: ["启动", "加载", "注册", "渲染", "交互"],
    datasets: [{
      label: "macOS plugin path",
      data: [1, 3, 4, 4, 5],
      borderColor: "rgb(75, 192, 192)",
      tension: 0.25
    }]
  }
}
```

## WaveDrom

```wavedrom
// ==BlockCodeConfig==
// @align            center
// @height           auto
// @backgroundColor  transparent
// ==/BlockCodeConfig==

{
  signal: [
    { name: "open",  wave: "p......." },
    { name: "load",  wave: "0.1.0..." },
    { name: "rpc",   wave: "x3x4x...", data: ["health", "read"] },
    { name: "ready", wave: "0...1..." }
  ],
  config: { hscale: 1.3 }
}
```
