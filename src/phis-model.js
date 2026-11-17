/* Local preparation model. No PHIS transport, login, worker or execution authority. */
(function () {
  'use strict';
  const labels = Object.freeze({pending:'요청 대기',review:'검토 필요',processing:'처리 중',completed:'입력 완료',failed:'입력 실패',cancelled:'요청 취소'});
  const capability = Object.freeze({connected:false,approved:false,execution:false,contractVersion:1});
  const localStates = new Set(['pending','review','cancelled']);
  function fail(code) { const e = new Error(code); e.code = code; throw e; }
  function date(value) { if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T00:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value; }
  function identity(input) {
    const out = {name:String(input?.name || '').trim(),birthDate:String(input?.birthDate || ''),consultationDate:String(input?.consultationDate || '')};
    if (out.name.length > 80 || (out.birthDate && !date(out.birthDate)) || (out.consultationDate && !date(out.consultationDate))) fail('IDENTITY');
    return out;
  }
  function effectiveIdentity(job) { return identity(job.review?.identity || job.snapshot.identity); }
  function flags(job) {
    const i = effectiveIdentity(job), out = [];
    if (!i.name) out.push('대상자 이름 미등록');
    else if (/[○*]/.test(i.name) || /^[가-힣]O[가-힣]{0,3}$/.test(i.name)) out.push('가려진 대상자 이름 · 실명 확인 필요');
    if (!i.birthDate) out.push('생년월일 미등록');
    if (!i.consultationDate) out.push('상담일자 미등록');
    if (!job.snapshot.memoText.trim()) out.push('상담메모 원문 없음');
    return out;
  }
  function validate(job) {
    if (!job || job.schema !== 1 || job.type !== 'phis-record-request' || !/^phis_[a-f0-9]{64}$/.test(job.id) || !/^[a-f0-9-]{36}$/.test(job.sourceId) || !/^[a-f0-9]{64}$/.test(job.ownerScope) || !/^[a-f0-9]{64}$/.test(job.cryptoScope) || !/^[a-f0-9]{64}$/.test(job.sourceFingerprint)) fail('FORMAT');
    if (!Object.hasOwn(labels,job.status) || !Number.isInteger(job.revision) || job.revision < 0 || !Number.isInteger(job.attempts) || job.attempts < 0 || !Array.isArray(job.history) || job.history.length > 1000) fail('FORMAT');
    if (!job.snapshot || typeof job.snapshot.memoText !== 'string' || job.snapshot.memoText.length > 100000 || !/^[a-f0-9]{64}$/.test(job.snapshot.memoHash) || !Number.isFinite(Date.parse(job.requestedAt))) fail('FORMAT');
    identity(job.snapshot.identity); if (job.review) identity(job.review.identity);
    if(job.error && (typeof job.error.type!=='string'||job.error.type.length>80||typeof job.error.message!=='string'||job.error.message.length>2000))fail('FORMAT');
    return job;
  }
  function state(job) { return localStates.has(job.status) ? job.status : 'review'; }
  function change(original,action,now,context={}) {
    validate(original);
    if (!localStates.has(original.status)) fail('UNVERIFIED_RESULT');
    const job = structuredClone(original), from = job.status;
    if (action === 'cancel' && ['pending','review'].includes(from)) job.status = 'cancelled';
    else if (action === 'review' && from === 'pending') job.status = 'review';
    else if (action === 'requeue' && ['cancelled','review'].includes(from)) { if (context.sourceStatus !== 'current') fail('SOURCE_CHANGED'); job.status = 'pending'; job.preparedAt = null; }
    else if (action === 'review_identity' && ['pending','review'].includes(from)) { job.review = {identity:identity(context.identity),verifiedAt:now}; if (from === 'review') job.status='pending'; job.preparedAt = null; }
    else if (action === 'prepare' && from === 'pending') { if (context.sourceStatus !== 'current') fail('SOURCE_CHANGED'); if (flags(job).length) fail('INCOMPLETE'); job.preparedAt = now; }
    else if (['start','complete','fail','worker_result','retry'].includes(action)) fail('NOT_CONNECTED');
    else fail('TRANSITION');
    job.revision++; job.updatedAt = now;
    job.history.push({at:now,action,from,to:job.status,revision:job.revision,actor:'local-owner'});
    return validate(job);
  }
  const maskName = value => { const s = String(value || ''); return s.length > 2 ? s[0]+'○'.repeat(Math.min(6,s.length-2))+s.at(-1) : s ? s[0]+'○' : '미등록'; };
  window.VHM_PHIS_MODEL = Object.freeze({labels,capability,validDate:date,identity,effectiveIdentity,flags,validate,state,change,maskName,fail});
})();
