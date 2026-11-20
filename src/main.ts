import { createApp } from 'vue';
import App from './App.vue';

// 引入 Element Plus（用于示例页面顶部操作栏按钮与消息提示）
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';

// 引入 jvs-ppt-ui 核心插件及自包含样式（已内置所有图标库与依赖样式，无需额外引入 iconfont）
import JvsPptUi from 'jvs-ppt-ui';
import 'jvs-ppt-ui/dist/lib/style.css';

const app = createApp(App);

app.use(ElementPlus);
app.use(JvsPptUi);

app.mount('#app');
