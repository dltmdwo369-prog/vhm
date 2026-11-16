/* Schedule images: local selection, encrypted private Drive files, opaque Calendar references. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const MAX = 3, LIMIT = 5 * 1048576;
  let items = [], raw = '', generation = 0, busy = false, previewURL = '';
  function clearPreview() {
    const dlg = $('#memoImagePreview');
    if (dlg && dlg.open) dlg.close();
    if (dlg) { dlg.querySelector('img').removeAttribute('src'); dlg.querySelector('a').removeAttribute('href'); }
    if (previewURL) URL.revokeObjectURL(previewURL);
    previewURL = '';
  }
  function reset() { generation++; items = []; raw = ''; clearPreview(); if ($('#memoImageInput')) $('#memoImageInput').value = ''; paint(); }
  function paint() {
    const list = $('#memoImageList'); if (!list) return;
    list.replaceChildren();
    $('#memoImagePick').disabled = busy || !!raw || items.length >= MAX;
    $('#memoImageDrive').hidden = !!(window.VHM_AUTH && VHM_AUTH.hasDrive);
    $('#memoImageHint').textContent = raw ? '첨부 목록을 읽지 못했습니다. 기존 연결은 보존됩니다.' : '파일당 5MB · 최대 3개 · 저장할 때 암호화합니다. 첨부 해제·일정 삭제 시 Drive 원본은 지우지 않습니다.';
    items.forEach((item, index) => {
      const row = document.createElement('div'); row.className = 'row'; row.style.cssText = 'margin-top:6px;min-width:0';
      const label = document.createElement('span'); label.textContent = item.file ? item.file.name : '🔒 첨부 이미지 ' + (index + 1); label.style.cssText = 'overflow-wrap:anywhere;min-width:0;flex:1';
      row.append(label);
      for (const [text, action] of [['보기', () => preview(item)], ['첨부 해제', async () => {
        if (busy) return;
        const session = generation;
        if (item.id && !(await MEMOLOCK.openNow('이미지 첨부를 해제하려면 메모 잠금을 풀어 주세요.'))) return;
        if (session !== generation) return;
        clearPreview(); items = items.filter(x => x !== item); paint();
      }]]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'small'; button.textContent = text; button.disabled = busy;
        button.onclick = () => Promise.resolve(action()).catch(e => toast(e.message || String(e), 6000)); row.append(button);
      }
      list.append(row);
    });
  }
  async function preview(item) {
    const session = generation;
    let image;
    if (item.file) image = {name:item.file.name, blob:item.file};
    else {
      if (!VHM_AUTH.hasDrive) return toast('이미지를 보려면 Drive 연결이 필요합니다. 작성 내용을 먼저 저장하세요.', 6000);
      if (!(await MEMOLOCK.openNow('첨부 이미지를 보려면 메모 잠금을 풀어 주세요.'))) return;
      image = await SERVER.readMemoImage(item.id);
    }
    if (session !== generation || !$('#eventDlg').open) return;
    clearPreview();
    let dlg = $('#memoImagePreview');
    if (!dlg) {
      dlg = document.createElement('dialog'); dlg.id = 'memoImagePreview'; dlg.setAttribute('aria-label', '첨부 이미지');
      dlg.innerHTML = '<div class="dlg-head"><h3>첨부 이미지</h3><button type="button">닫기</button></div><div class="dlg-body"><p></p><img alt="첨부 이미지 미리보기" style="display:block;max-width:100%;max-height:60vh;object-fit:contain"><a class="btn" download>이미지 내려받기</a></div>';
      document.body.append(dlg); dlg.querySelector('button').onclick = clearPreview; dlg.addEventListener('close', clearPreview);
    }
    previewURL = URL.createObjectURL(image.blob);
    dlg.querySelector('p').textContent = image.name;
    dlg.querySelector('img').src = previewURL;
    const link = dlg.querySelector('a'); link.href = previewURL; link.download = image.name;
    dlg.showModal();
  }
  async function select() {
    const input = $('#memoImageInput'), files = Array.from(input.files || []); input.value = '';
    if (busy || raw) return;
    if (files.length + items.length > MAX) return toast('이미지는 일정마다 최대 3개까지 첨부할 수 있습니다.');
    // Reject active image formats such as SVG before showing a local preview.
    if (files.some(f => !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(f.type) || !f.size || f.size > LIMIT)) return toast('PNG, JPG, GIF, WEBP 이미지만 파일당 5MB까지 선택하세요.', 6000);
    items.push(...files.map(file => ({file}))); paint();
  }
  window.MEMO_IMAGES = {
    open(d) { reset(); raw = d.imageIds === null ? d.imageIdsRaw : ''; items = (d.imageIds || []).map(id => ({id})); paint(); },
    read() { return raw ? {imageIds:null, imageIdsRaw:raw} : {imageIds:items.filter(x => x.id).map(x => x.id)}; },
    hasPending() { return items.some(x => x.file); },
    reset,
    lock() { generation++; clearPreview(); items = items.filter(x => x.id).map(x => ({id:x.id})); $('#memoImageInput').value = ''; paint(); },
    async prepare(e) {
      if (!items.some(x => x.file && !x.id)) return true;
      if (!VHM_AUTH.hasDrive) { toast('이미지 첨부에는 Drive 연결이 필요합니다. 작성 내용을 먼저 저장한 뒤 Drive를 연결하세요.', 7000); return false; }
      const session = generation;
      if (!(await MEMOLOCK.openNow('이미지를 암호화하여 저장하려면 메모 잠금을 풀어 주세요.'))) return false;
      if (session !== generation) return false;
      busy = true; paint();
      try {
        for (const item of items) {
          if (!item.id) {
            const id = await SERVER.uploadMemoImage(item.file);
            if (session !== generation || !VHM_AUTH.valid()) return false;
            item.id = id;
          }
        }
        e.imageIds = items.map(x => x.id); return true;
      } catch (err) { toast('이미지 저장 실패: ' + (err.message || err) + ' 선택한 파일을 유지했으니 다시 저장하세요.', 8000); return false; }
      finally { busy = false; paint(); }
    }
  };
  $('#memoImagePick').onclick = () => {
    if (!VHM_AUTH.hasDrive) return toast('작성 내용을 먼저 저장한 뒤 ‘Drive 연결’을 눌러 주세요. 연결 시 이 창은 초기화됩니다.', 7000);
    $('#memoImageInput').click();
  };
  $('#memoImageInput').onchange = select;
  $('#memoImageDrive').onclick = () => VHM_AUTH.request('drive').catch(e => toast(e.message || e));
  $('#eventDlg').addEventListener('close', () => { if (!$('#eventDlg').open) reset(); });
})();
