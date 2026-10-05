import './styles/main.css';
import { probe } from './store/storage.js';
import { reload, watchOtherTabs } from './store/state.js';
import { ui } from './ui/uiState.js';
import { render } from './ui/render.js';
import * as dialogs from './ui/dialogs.js';
import * as shiftForm from './ui/shiftForm.js';
import * as historyUI from './ui/history.js';
import * as savingsDialog from './ui/savingsDialog.js';
import * as setup from './ui/setup.js';
import * as settings from './ui/settings.js';
import * as jsonIO from './ui/jsonIO.js';
import * as qrExport from './ui/qrExport.js';
import * as qrImport from './ui/qrImport.js';

/* ---------- 起動 ---------- */
for (const m of [
  dialogs,
  shiftForm,
  historyUI,
  savingsDialog,
  setup,
  settings,
  jsonIO,
  qrExport,
  qrImport,
])
  m.init();
probe();
reload();
shiftForm.resetShiftForm();
render();

// 日付をまたいで開きっぱなしでも、戻ってきたときに計算し直す
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) render();
});
// 別タブでの変更を反映する
watchOtherTabs(() => {
  ui.editingId = null;
  render();
});
