// Requires a local Firestore emulator, never production. See docs/FEEDBACK.md.
const assert = require('node:assert/strict');
const host = process.env.FIRESTORE_EMULATOR_HOST;
if (!host || !/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error('Set FIRESTORE_EMULATOR_HOST to a local emulator.');
const root = 'projects/demo-vhm/databases/(default)/documents';
const base = 'http://' + host + '/v1/' + root;
const str = stringValue => ({stringValue});
function jwt(uid, verified=true) {
  const enc = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor(Date.now()/1000);
  return enc({alg:'none',typ:'JWT'})+'.'+enc({iss:'https://securetoken.google.com/demo-vhm',aud:'demo-vhm',sub:uid,user_id:uid,iat:now,exp:now+3600,email:uid==='admin'?'dltmdwo369@gmail.com':uid+'@example.test',email_verified:verified,firebase:{sign_in_provider:'google.com',identities:{'google.com':[uid]}}})+'.';
}
async function req(path, token, body, method=body?'POST':'GET') {
  return fetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
}
async function expect(label, expected, response) { const r = await response; const t = await r.text(); assert.equal(r.status,expected,label+': '+t); console.log('PASS '+label); return JSON.parse(t||'{}'); }
(async () => {
  const a=jwt('alice'), b=jwt('bob'), admin=jwt('admin');
  const name = root+'/feedback/rules-'+Date.now();
  const fields={authorId:str('alice'),authorEmail:str('alice@example.test'),title:str('가상 제목'),body:str('가상 내용'),category:str('기타'),status:str('접수'),reply:str('')};
  const create={writes:[{update:{name,fields},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]}]};
  await expect('anonymous creation denied',403,req(':commit',null,create));
  await expect('unverified Google account denied',403,req(':commit',jwt('alice',false),create));
  await expect('verified user creates own feedback in 접수 state',200,req(':commit',a,create));
  const docPath=name.slice(root.length);
  await expect('author reads own feedback',200,req(docPath,a));
  await expect('another user cannot read feedback',403,req(docPath,b));
  await expect('admin reads feedback',200,req(docPath,admin));
  const query={structuredQuery:{from:[{collectionId:'feedback'}],where:{fieldFilter:{field:{fieldPath:'authorId'},op:'EQUAL',value:str('alice')}},orderBy:[{field:{fieldPath:'createdAt'},direction:'DESCENDING'},{field:{fieldPath:'__name__'},direction:'DESCENDING'}],limit:51}};
  await expect('own-user paginated list allowed',200,req(':runQuery',a,query));
  delete query.structuredQuery.where;
  await expect('ordinary user cannot list all feedback',403,req(':runQuery',a,query));
  await expect('admin lists all feedback',200,req(':runQuery',admin,query));
  const update=(status,extra={})=>({writes:[{update:{name,fields:{status:str(status),reply:str('가상 답변'),...extra}},updateMask:{fieldPaths:['status','reply',...Object.keys(extra)]},updateTransforms:[{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]}]});
  await expect('author cannot change status',403,req(':commit',a,update('해결완료')));
  await expect('other user cannot change status',403,req(':commit',b,update('해결완료')));
  for(const status of ['미해결','해결완료','접수']) await expect('admin sets '+status,200,req(':commit',admin,update(status)));
  await expect('admin cannot set unknown status',403,req(':commit',admin,update('무효')));
  await expect('admin cannot alter original text',403,req(':commit',admin,update('접수',{body:str('변경')})));
  await expect('user cannot assign self admin',403,req('/feedbackAdmins?documentId=alice',a,{fields:{enabled:{booleanValue:true}}}));
  const forge=JSON.parse(JSON.stringify(create)); forge.writes[0].update.name+='-forged';forge.writes[0].update.fields.authorId=str('bob');
  await expect('forged author denied',403,req(':commit',a,forge));
  const resolved=JSON.parse(JSON.stringify(create)); resolved.writes[0].update.name+='-resolved'; resolved.writes[0].update.fields.status=str('해결완료');
  await expect('creating already resolved feedback denied',403,req(':commit',a,resolved));
  const oversized=JSON.parse(JSON.stringify(create)); oversized.writes[0].update.name+='-long';oversized.writes[0].update.fields.body=str('x'.repeat(3001));
  await expect('oversized feedback denied',403,req(':commit',a,oversized));
  await expect('feedback deletion denied even to admin',403,req(docPath,admin,null,'DELETE'));
  const imageId=require('node:crypto').randomUUID();
  const imageParent=root+'/feedback/images-'+Date.now();
  const imageFields={authorId:str('alice'),name:str('가상 이미지.jpg'),dataUrl:str('data:image/jpeg;base64,/9j/AA==')};
  const imageCreate={writes:[
    {update:{name:imageParent,fields:{...fields,imageIds:{arrayValue:{values:[str(imageId)]}}}},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'},{fieldPath:'updatedAt',setToServerValue:'REQUEST_TIME'}]},
    {update:{name:imageParent+'/images/'+imageId,fields:imageFields},currentDocument:{exists:false},updateTransforms:[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]}
  ]};
  const missing=JSON.parse(JSON.stringify(imageCreate));missing.writes.pop();
  await expect('parent cannot reference an image that is not in the atomic commit',403,req(':commit',a,missing));
  const svg=JSON.parse(JSON.stringify(imageCreate));svg.writes[1].update.fields.dataUrl=str('data:image/svg+xml;base64,PHN2Zy8+');
  await expect('SVG attachment denied',403,req(':commit',a,svg));
  const largeImage=JSON.parse(JSON.stringify(imageCreate));largeImage.writes[1].update.fields.dataUrl=str('data:image/jpeg;base64,'+'A'.repeat(245760));
  await expect('oversized attachment denied',403,req(':commit',a,largeImage));
  const tooMany=JSON.parse(JSON.stringify(imageCreate));tooMany.writes[0].update.fields.imageIds={arrayValue:{values:Array.from({length:4},()=>str(require('node:crypto').randomUUID()))}};
  await expect('more than three attachment IDs denied',403,req(':commit',a,tooMany));
  await expect('feedback and JPEG attachment created atomically',200,req(':commit',a,imageCreate));
  const imagePath=(imageParent+'/images/'+imageId).slice(root.length);
  await expect('author reads own attachment',200,req(imagePath,a));
  await expect('other user cannot read attachment',403,req(imagePath,b));
  await expect('admin reads attachment',200,req(imagePath,admin));
  await expect('image enumeration denied',403,req(imageParent.slice(root.length)+'/images',a));
  await expect('attachment replacement denied',403,req(imagePath,a,{fields:imageFields},'PATCH'));
  const after=JSON.parse(JSON.stringify(imageCreate));after.writes.shift();after.writes[0].update.name=imageParent+'/images/'+require('node:crypto').randomUUID();
  await expect('adding attachment after feedback creation denied',403,req(':commit',a,after));
})().catch(e=>{console.error(e);process.exitCode=1;});
