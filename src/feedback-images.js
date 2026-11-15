/* Raster-only feedback attachments. Images are resized and re-encoded locally before upload. */
(function () {
  'use strict';
  const MAX_IMAGES = 3, MAX_DATA = 245760;
  const safe = value => typeof value === 'string' && value.length <= MAX_DATA && /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
  async function prepare(file) {
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) throw new Error('JPG, PNG, WebP 이미지만 첨부할 수 있습니다.');
    if (!file.size || file.size > 10 * 1024 * 1024) throw new Error('이미지는 한 장당 10MB 이하로 선택해 주세요.');
    const url = URL.createObjectURL(file), img = new Image();
    try {
      img.src = url; await img.decode();
      if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > 40000000) throw new Error('이미지 크기가 너무 큽니다. 화면 캡처나 크기를 줄인 이미지로 다시 선택해 주세요.');
      const canvas = document.createElement('canvas');
      let scale = Math.min(1,1600/Math.max(img.naturalWidth,img.naturalHeight));
      for (let attempt=0;attempt<8;attempt++) {
        canvas.width = Math.max(1,Math.round(img.naturalWidth*scale)); canvas.height = Math.max(1,Math.round(img.naturalHeight*scale));
        const ctx = canvas.getContext('2d'); ctx.fillStyle='#fff'; ctx.fillRect(0,0,canvas.width,canvas.height); ctx.drawImage(img,0,0,canvas.width,canvas.height);
        for (const quality of [0.9,0.8,0.7]) {
          const dataUrl = canvas.toDataURL('image/jpeg',quality);
          if (safe(dataUrl)) return {id:crypto.randomUUID(),name:file.name.slice(0,120),dataUrl};
        }
        scale *= 0.75;
      }
      throw new Error('이미지를 줄이지 못했습니다. 더 작은 이미지로 다시 선택해 주세요.');
    } catch(e) { if(e.name==='EncodingError') throw new Error('이미지 파일을 읽을 수 없습니다. 다른 이미지를 선택해 주세요.'); throw e; }
    finally { URL.revokeObjectURL(url); }
  }
  window.VHM_FEEDBACK_IMAGES = {prepare, safe, MAX_IMAGES};
})();
