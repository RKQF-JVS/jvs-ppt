# jvs-ppt-ui

`jvs-ppt-ui` 是一个基于 Vue 3 开发的在线 PPT 演示文稿编辑器组件库，支持标准 `.pptx` 文件导入导出、母版与版式渲染、动画播放、AI 一键美化、素材库与自定义资源上传。

## 📦 安装

```bash
npm install jvs-ppt-ui
# 或使用 yarn
yarn add jvs-ppt-ui
# 或使用 pnpm
pnpm add jvs-ppt-ui
```

## 🚀 快速上手

### 1. 全局注册（Plugin 模式）

在项目的全局入口文件（`main.ts`）中引入并注册：

```typescript
import { createApp } from 'vue';
import App from './App.vue';

// 引入 jvs-ppt-ui 及其样式（已自包含所有内置组件与图标库）
import JvsPptUi from 'jvs-ppt-ui';
import 'jvs-ppt-ui/dist/lib/style.css';

const app = createApp(App);
app.use(JvsPptUi); // 注册全局组件 <PptEditor /> 和 <JvsPptEditor />
app.mount('#app');
```

### 2. 按需引入组件

```vue
<template>
  <div class="ppt-container">
    <PptEditor
      ref="pptRef"
      v-model="deckData"
      :readonly="false"
      :show-header="true"
      @save="onSave"
      @change="onChange"
    />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { PptEditor, type PptEditorApi, type DeckData } from 'jvs-ppt-ui';
import 'jvs-ppt-ui/dist/lib/style.css';

const pptRef = ref<PptEditorApi | null>(null);
const deckData = ref<DeckData | null>(null);

const onSave = (payload: any) => {
  console.log('保存 PPT 数据:', payload);
};

const onChange = (data: any) => {
  console.log('内容变更:', data);
};
</script>

<style scoped>
.ppt-container {
  width: 100vw;
  height: 100vh;
  margin: 0;
  padding: 0;
  overflow: hidden;
}
</style>
```

## 🛠️ 常用 Props 配置

| 属性名 | 类型 | 默认值 | 说明 |
| :--- | :---: | :---: | :--- |
| `modelValue` | `Slide[] \| DeckData \| null` | `null` | 幻灯片数据，支持 `v-model` 双向绑定 |
| `readonly` | `boolean` | `false` | 是否只读/预览模式（禁用编辑，保留缩放、放映与导入导出） |
| `showHeader` | `boolean` | `true` | 是否展示顶部导航与工具栏 |
| `showMenu` | `boolean` | `true` | 是否展示左上角主菜单按钮 |
| `toolbarMode` | `'auto' \| 'more' \| 'full'` | `'auto'` | 工具栏布局模式 |
| `showSidebarLeft` | `boolean` | `true` | 是否展示左侧缩略图列表 |
| `showSidebarRight` | `boolean` | `true` | 是否展示右侧属性面板 |
| `customUpload` | `Function` | `undefined` | 自定义资源上传函数 `(fileOrBlob, context) => Promise<string>` |
| `enableTemplate` | `boolean` | `true` | 是否启用模板库功能 |
| `templates` | `SlideTemplateInput[]` | `undefined` | 自定义传入的模板列表 |

## 🔌 常用 Expose API 方法

通过 `ref` 获取组件实例后可调用以下方法：

- `getSaveData(): DeckData` — 同步获取当前完整的工程 JSON 数据
- `save(options?: SaveOptions): Promise<any>` — 获取指定格式产物（`'json'` | `'pptx'` | `'pptx-file'` | `'images-zip'`）
- `loadFile(source, options?): Promise<LoadSourceResult>` — 万能加载接口，支持传入本地 `File`、`Blob`、远程 URL 或 JSON
- `exportPptx(): Promise<void>` — 导出并下载标准 `.pptx` 文件
- `exportJson(): void` — 导出并下载 `.json` 工程文件
- `exportImages(): Promise<void>` — 导出所有幻灯片高清图片 `.zip`
- `addSlide(index?: number): void` — 新增空白幻灯片
- `deleteSlide(index?: number): void` — 删除指定幻灯片
- `startPresentation(): void` — 进入全屏放映模式
- `undo()` / `redo()` — 撤销 / 重做
