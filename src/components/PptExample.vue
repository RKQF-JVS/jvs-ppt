<template>
  <div class="ppt-container">
    <PptEditor
      v-model="deckData"
      :readonly="false"
      :show-header="true"
      :custom-upload="handleCustomUpload"
      @save="onSave"
      @change="onChange"
      @slideChange="onSlideChange"
      @load="onLoad"
      @ready="onReady"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick, onMounted, onBeforeUnmount, toRaw, type WatchStopHandle } from 'vue';
import { PptEditor, type PptEditorApi, type DeckData, type UploadResourceContext } from 'jvs-ppt-ui';
import {
  loadPptSnapshotFromBrowser,
  savePptSnapshotToBrowser,
  flushPptSnapshotOnUnload,
  blobToPersistentDataUrl,
  type PersistedPptSnapshot
} from '../utils/pptBrowserStorage';

const deckData = ref<DeckData | null>(null);

let editorApi: PptEditorApi | null = null;
let isRestoring = true;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const stopHandles: WatchStopHandle[] = [];

function clonePlain<T>(val: T): T {
  if (val === undefined || val === null) return val;
  return JSON.parse(JSON.stringify(toRaw(val)));
}

/**
 * 从当前编辑器实例提取完整的持久化快照（包含母版、主题、尺寸比例、激活页与所有幻灯片）
 */
function buildCurrentSnapshot(): PersistedPptSnapshot | null {
  if (!editorApi) return null;
  const s = editorApi.slidesComposable;
  const baseDeck = editorApi.getSaveData();

  if (!s) {
    return {
      version: 1,
      updatedAt: Date.now(),
      activeIndex: editorApi.getActiveIndex?.() || 0,
      deck: baseDeck
    };
  }

  const masters = clonePlain(s.slideMasters?.value || baseDeck.slideMasters || []);
  const width = s.logicalWidth?.value || baseDeck.logicalWidth || 1280;
  const height = s.logicalHeight?.value || baseDeck.logicalHeight || 720;
  const ratio = s.slideRatio?.value || baseDeck.slideRatio || '16:9';

  return {
    version: 1,
    updatedAt: Date.now(),
    activeIndex: typeof s.activeIndex?.value === 'number' ? s.activeIndex.value : 0,
    deck: {
      ...baseDeck,
      title: s.presentationTitle?.value || baseDeck.title || '未命名演示文稿',
      width,
      height,
      ratio,
      logicalWidth: width,
      logicalHeight: height,
      slideRatio: ratio,
      slideHeight: s.slideHeight?.value || baseDeck.slideHeight || height,
      theme: {
        fontFamily: s.globalFontFamily?.value || '默认字体',
        fontColor: s.globalFontColor?.value || '#000000',
        themeColor: clonePlain(
          s.globalThemeColor?.value || ['#3b82f6', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6']
        ),
        backgroundColor: s.globalBgColor?.value || '#ffffff'
      },
      activeMasterId: s.activeMasterId?.value || masters[0]?.id || 'master-default',
      masters,
      slideMasters: masters,
      schemeFillMap: clonePlain(s.themeSchemeFillMap?.value || {}),
      themeClrScheme: clonePlain(s.themeClrScheme?.value || baseDeck.themeClrScheme || {}),
      zipMeta: clonePlain(s.currentZipMeta?.value || null),
      styleRecipes: clonePlain(s.builtinStyleRecipes || []),
      slides: clonePlain(s.slides?.value || baseDeck.slides || [])
    }
  };
}

/**
 * 立即持久化当前 PPT 数据到浏览器
 */
async function persistNow() {
  if (isRestoring || !editorApi) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const snapshot = buildCurrentSnapshot();
  if (!snapshot) return;
  await savePptSnapshotToBrowser(snapshot);
}

/**
 * 防抖持久化（避免高频输入或拖拽期间频繁序列化）
 */
function schedulePersist(delay = 300) {
  if (isRestoring || !editorApi) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
  }
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void persistNow();
  }, delay);
}

// 编辑器初始化完成回调：从浏览器恢复本地已保存的数据
const onReady = async (api: PptEditorApi) => {
  editorApi = api;
  isRestoring = true;

  try {
    const cached = await loadPptSnapshotFromBrowser();
    if (cached && cached.deck && Array.isArray(cached.deck.slides) && cached.deck.slides.length > 0) {
      const s = api.slidesComposable;
      if (s && typeof s.importSlides === 'function') {
        s.importSlides(cached.deck);
        // 静默恢复，不在页面刷新时弹出“导入幻灯片成功”提示
        if (s.showNotification) {
          s.showNotification.value = false;
        }
        const targetIdx = Number(cached.activeIndex || 0);
        if (targetIdx >= 0 && targetIdx < (s.slides?.value?.length || 0)) {
          api.selectSlide(targetIdx);
        }
      } else {
        api.loadDeck(cached.deck);
      }
      deckData.value = api.getSaveData();
    }
  } catch (err) {
    console.warn('[jvs-ppt-demo] 恢复浏览器本地 PPT 数据失败:', err);
  } finally {
    await nextTick();
    isRestoring = false;
  }

  // 监听版本号、标题、画布比例、全局主题等变更，确保所有编辑、导入、模板应用都能自动落盘
  const s = api.slidesComposable;
  if (s) {
    const watchTargets = [
      () => s.slidesRevision?.value,
      () => s.presentationTitle?.value,
      () => s.slideRatio?.value,
      () => s.logicalWidth?.value,
      () => s.logicalHeight?.value,
      () => s.globalFontFamily?.value,
      () => s.globalFontColor?.value,
      () => s.globalBgColor?.value,
      () => s.globalThemeColor?.value,
      () => s.activeMasterId?.value
    ];
    stopHandles.push(
      watch(
        watchTargets,
        () => {
          if (!isRestoring) {
            schedulePersist();
          }
        },
        { deep: true }
      )
    );
  }
};

// 自定义资源上传：转为 Base64 DataURL 存入幻灯片数据，刷新浏览器后图片/媒体依然有效
const handleCustomUpload = async (fileOrBlob: File | Blob, _context: UploadResourceContext): Promise<string> => {
  try {
    return await blobToPersistentDataUrl(fileOrBlob);
  } catch {
    return URL.createObjectURL(fileOrBlob);
  }
};

// 保存事件回调
const onSave = () => {
  void persistNow();
};

// 内容变更回调
const onChange = () => {
  schedulePersist();
};

// 外部文件（PPTX/JSON/XML）导入完成回调
const onLoad = () => {
  void persistNow();
};

// 页码切换回调
const onSlideChange = () => {
  schedulePersist(150);
};

// 页面刷新或关闭前立即冲刷未落盘的数据
const handleBeforeUnload = () => {
  if (isRestoring || !editorApi) return;
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  const snapshot = buildCurrentSnapshot();
  if (snapshot) {
    flushPptSnapshotOnUnload(snapshot);
  }
};

const handleVisibilityChange = () => {
  if (document.visibilityState === 'hidden') {
    handleBeforeUnload();
  }
};

onMounted(() => {
  window.addEventListener('beforeunload', handleBeforeUnload);
  document.addEventListener('visibilitychange', handleVisibilityChange);
});

onBeforeUnmount(() => {
  window.removeEventListener('beforeunload', handleBeforeUnload);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  stopHandles.forEach((stop) => stop());
  stopHandles.length = 0;
  handleBeforeUnload();
});
</script>

<style scoped>
.ppt-container {
  width: 100%;
  height: 100vh;
  overflow: hidden;
}

.ppt-container > * {
  height: 100%;
  width: 100%;
}
</style>
