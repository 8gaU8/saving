// UI モジュール間で共有する画面の状態（保存しない）
export const PAGE_SIZE = 20;

export const ui = {
  editingId: null,         // 編集中の勤務 ID
  historyLimit: PAGE_SIZE, // 履歴の表示件数
  defaultDate: ''          // 勤務フォームの日付の既定値（日付またぎで追従）
};
