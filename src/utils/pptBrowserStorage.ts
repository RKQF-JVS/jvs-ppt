import type { DeckData } from 'jvs-ppt-ui';

/**
 * 独立于 jvs-ppt-ui 内部存储的专属命名空间
 * jvs-ppt-ui 内部使用的是:
 * - localStorage: 'jvs_ppt_custom_style_recipes_v1'
 * - localStorage/sessionStorage: 'jvs-*' / 'color_picker_histroy'
 *
 * 本项目使用独立的 IndexedDB 数据库与专属前缀的 localStorage Key，互不干扰。
 */
const DB_NAME = 'jvs_ppt_demo_standalone_db_v1';
const DB_VERSION = 1;
const STORE_NAME = 'demo_ppt_workspace';
const RECORD_KEY = 'current_ppt_deck';
const LOCAL_STORAGE_KEY = 'jvs_ppt_demo_standalone_deck_v1';

export interface PersistedDeckPayload extends DeckData {
  width?: number;
  height?: number;
  ratio?: string;
  theme?: {
    fontFamily: string;
    fontColor: string;
    themeColor: string[];
    backgroundColor: string;
  };
  activeMasterId?: string;
  masters?: any[];
  schemeFillMap?: Record<string, any>;
  zipMeta?: any;
  styleRecipes?: any[];
}

export interface PersistedPptSnapshot {
  version: number;
  updatedAt: number;
  activeIndex: number;
  deck: PersistedDeckPayload;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openStorageDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };

      request.onerror = () => {
        console.warn('[jvs-ppt-demo] IndexedDB 打开失败，将降级使用 localStorage:', request.error);
        dbPromise = null;
        resolve(null);
      };
    } catch (err) {
      console.warn('[jvs-ppt-demo] IndexedDB 初始化异常:', err);
      dbPromise = null;
      resolve(null);
    }
  });

  return dbPromise;
}

function readFromIndexedDb(): Promise<PersistedPptSnapshot | null> {
  return openStorageDb().then((db) => {
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(RECORD_KEY);

        req.onsuccess = () => {
          const val = req.result;
          if (val && typeof val === 'object' && val.deck && Array.isArray(val.deck.slides)) {
            resolve(val as PersistedPptSnapshot);
          } else {
            resolve(null);
          }
        };

        req.onerror = () => {
          resolve(null);
        };
      } catch {
        resolve(null);
      }
    });
  });
}

function writeToIndexedDb(snapshot: PersistedPptSnapshot): Promise<boolean> {
  return openStorageDb().then((db) => {
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put(snapshot, RECORD_KEY);

        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
        tx.onabort = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  });
}

function readFromLocalStorage(): PersistedPptSnapshot | null {
  if (typeof window === 'undefined' || !window.localStorage) return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.deck && Array.isArray(parsed.deck.slides)) {
      return parsed as PersistedPptSnapshot;
    }
  } catch (err) {
    console.warn('[jvs-ppt-demo] 读取 localStorage 缓存失败:', err);
  }
  return null;
}

function writeToLocalStorageSync(snapshot: PersistedPptSnapshot): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(snapshot));
    return true;
  } catch {
    // 当幻灯片内含大量高清 Base64 图片超出 localStorage 5MB 配额时静默忽略，由 IndexedDB 承载全量数据
    return false;
  }
}

/**
 * 保存 PPT 工程快照至当前浏览器（IndexedDB + localStorage 双保险，命名空间隔离）
 */
export async function savePptSnapshotToBrowser(snapshot: PersistedPptSnapshot): Promise<void> {
  // 1. 同步尝试写入 localStorage（保障页面突发刷新/关闭时的瞬时持久化）
  writeToLocalStorageSync(snapshot);
  // 2. 异步写入大容量 IndexedDB
  await writeToIndexedDb(snapshot);
}

/**
 * 页面卸载前的同步冲刷保存
 */
export function flushPptSnapshotOnUnload(snapshot: PersistedPptSnapshot): void {
  writeToLocalStorageSync(snapshot);
  void writeToIndexedDb(snapshot);
}

/**
 * 从当前浏览器读取最新的 PPT 工程快照
 */
export async function loadPptSnapshotFromBrowser(): Promise<PersistedPptSnapshot | null> {
  const [idbSnapshot, lsSnapshot] = await Promise.all([
    readFromIndexedDb(),
    Promise.resolve(readFromLocalStorage())
  ]);

  if (idbSnapshot && lsSnapshot) {
    const idbTime = Number(idbSnapshot.updatedAt || 0);
    const lsTime = Number(lsSnapshot.updatedAt || 0);
    if (lsTime > idbTime) {
      // 若页面刷新前同步写入了更新的 localStorage 快照，将其回写同步至 IndexedDB
      void writeToIndexedDb(lsSnapshot);
      return lsSnapshot;
    }
    return idbSnapshot;
  }

  return idbSnapshot || lsSnapshot || null;
}

/**
 * 将上传的 File / Blob 转为可持久化的 Base64 DataURL（避免 blob: URL 在刷新页面后失效）
 */
export function blobToPersistentDataUrl(fileOrBlob: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
      } else {
        reject(new Error('FileReader 未返回有效的 DataURL 字符串'));
      }
    };
    reader.onerror = () => {
      reject(reader.error || new Error('读取文件为 DataURL 失败'));
    };
    reader.readAsDataURL(fileOrBlob);
  });
}
