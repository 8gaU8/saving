import { $ } from './dom.js';

export function confirmDialog({ title, message, ok = 'OK', danger = false }) {
  return new Promise((resolve) => {
    const d = $('#dlgConfirm');
    const okBtn = $('#cfOk');
    $('#cfTitle').textContent = title;
    $('#cfMsg').textContent = message;
    okBtn.textContent = ok;
    okBtn.className = 'btn ' + (danger ? 'danger-solid' : 'primary');
    let result = false;
    const onOk = () => {
      result = true;
      d.close();
    };
    const onClose = () => {
      okBtn.removeEventListener('click', onOk);
      d.removeEventListener('close', onClose);
      resolve(result);
    };
    okBtn.addEventListener('click', onOk);
    d.addEventListener('close', onClose);
    d.showModal();
  });
}

// キャンセルボタン、[data-close]、背景クリックで閉じる
export function init() {
  $('#cfCancel').addEventListener('click', () => $('#dlgConfirm').close());

  document.addEventListener('click', (e) => {
    const closer = e.target.closest('[data-close]');
    if (closer) {
      closer.closest('dialog').close();
      return;
    }
    if (e.target instanceof HTMLDialogElement) e.target.close(); // 背景クリックで閉じる
  });
}
