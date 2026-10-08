'use client';
import { useEffect, useState, type FormEvent } from 'react';
import type { AdminKey } from '@field-service/i18n';
import { Eye, EyeOff } from 'lucide-react';
import { call, ConsoleError, useStepUp, useText } from './api';
interface Settings { version:number;account_id?:string;mode?:'test'|'live';credential_id?:string;card_enabled:boolean;qr_enabled:boolean;
  key_configured:boolean;webhook_configured:boolean;webhook_path:string|null;next_credential_id:string;next_webhook_path:string;server_ready:boolean;transfer_configured:boolean }
type Check = { tone:'ok'|'bad'|'warn'; key:AdminKey; params?:Record<string,string|number> } | null;
/** Start and last 4 characters only, so the owner can compare with Stripe without the page showing the secret. */
const preview = (v:string, head:number) => `${v.slice(0, head)}…${v.slice(-4)}`;
function checkKey(v:string): Check {
  if (!v) return null;
  if (/\s/.test(v)) return { tone:'bad', key:'keyHasSpace' };
  if (/^rk_/.test(v)) return { tone:'bad', key:'keyIsRestricted' };
  if (/^pk_/.test(v)) return { tone:'bad', key:'keyIsPublishable' };
  if (/^whsec_/.test(v)) return { tone:'bad', key:'keyIsWebhook' };
  const m = /^sk_(test|live)_[A-Za-z0-9]{8,}$/.exec(v);
  return m ? { tone:'ok', key:'keyOk', params:{ mode:m[1]!, preview:preview(v, m[0].indexOf('_', 3) + 1), n:v.length } } : { tone:'bad', key:'keyBadFormat' };
}
function checkWebhook(v:string): Check {
  if (!v) return null;
  if (/\s/.test(v)) return { tone:'bad', key:'keyHasSpace' };
  if (/^we_/.test(v)) return { tone:'bad', key:'webhookIsEndpoint' };
  if (/^(sk|rk|pk)_/.test(v)) return { tone:'bad', key:'webhookIsKey' };
  return /^whsec_[A-Za-z0-9]{8,}$/.test(v) ? { tone:'ok', key:'webhookOk', params:{ preview:preview(v, 6), n:v.length } } : { tone:'bad', key:'webhookBadFormat' };
}
/** Secret input with show/hide; never offered to the browser's password manager. */
function SecretField({ label, value, onChange, required, check }: { label:string; value:string; onChange:(v:string)=>void; required:boolean; check:Check }) {
  const t = useText(), [shown, setShown] = useState(false);
  return <div className="secret-field"><label>{label}
    <span className="secret-input"><input type={shown?'text':'password'} autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true" value={value} required={required}
      onChange={e=>onChange(e.target.value.trim())} maxLength={500}/>
      <button type="button" className="icon-btn" aria-label={t(shown?'hideValue':'showValue')} title={t(shown?'hideValue':'showValue')} onClick={()=>setShown(!shown)}>{shown?<EyeOff size={17}/>:<Eye size={17}/>}</button></span></label>
    {check ? <p className={`key-check ${check.tone}`} role={check.tone==='bad'?'alert':'status'}>{check.tone==='ok'?'✓ ':check.tone==='bad'?'✗ ':'! '}{t(check.key, check.params)}</p> : null}</div>;
}
export function PaymentSettingsView(){
 const t=useText(),step=useStepUp();
 const [data,setData]=useState<Settings|null>(null),[card,setCard]=useState(false),[qr,setQr]=useState(false);
 const [key,setKey]=useState(''),[secret,setSecret]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState('');
 const apply=(s:Settings)=>{setData(s);setCard(s.card_enabled);setQr(s.qr_enabled);};
 const load=()=>call<Settings>('GET','/platform/payment-settings').then(apply,e=>setError(e.message));
 useEffect(()=>{void load();},[]);
 const keyCheck=checkKey(key), webhookCheck=checkWebhook(secret);
 const newMode=keyCheck?.tone==='ok'?String(keyCheck.params!.mode):null;
 const modeNote:Check=newMode&&data?.mode&&newMode!==data.mode?{tone:'warn',key:'keyModeChange',params:{mode:t(newMode==='live'?'keyModeLive':'keyModeTest'),saved:t(data.mode==='live'?'keyModeLive':'keyModeTest')}}:null;
 const keyShown:Check=newMode&&keyCheck?{...keyCheck,params:{...keyCheck.params,mode:t(newMode==='live'?'keyModeLive':'keyModeTest')}}:keyCheck;
 const pairMissing=Boolean(key)!==Boolean(secret);
 const blocked=keyCheck?.tone==='bad'||webhookCheck?.tone==='bad'||pairMissing;
 async function save(e:FormEvent){e.preventDefault();if(!data||busy||blocked)return;setBusy(true);setError('');setDone('');
   try{const value=await step(()=>call<Settings>('POST','/platform/payment-settings',{version:data.version,credential_id:data.next_credential_id,secret_key:key||undefined,webhook_secret:secret||undefined,card_enabled:card,qr_enabled:qr}));apply(value);setKey('');setSecret('');setDone(t('saved'));}
   catch(e){
     // Say which part failed instead of one generic message.
     const fields=e instanceof ConsoleError?e.fieldErrors:{};
     setError(fields.secret_key==='stripe.keyRejected'?t('keyRejected'):fields.qr_enabled?e instanceof Error?e.message:t('settingsReview')
       :e instanceof ConsoleError&&e.status===422&&e.code==='TEMPORARILY_UNAVAILABLE'?t('stripeNotActivated')
       :e instanceof ConsoleError&&e.code==='VALIDATION_ERROR'?t('settingsReview'):e instanceof Error?e.message:t('settingsError'));}
   finally{setBusy(false);}
 }
 const endpoint=data?`${(process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000').replace(/\/$/,'')}${key||secret||!data.webhook_path?data.next_webhook_path:data.webhook_path}`:'';
 return <><h1>{t('paymentSettings')}</h1><p>{t('stripeSettingsHint')}</p><button className="ghost" disabled={busy} onClick={()=>{setKey('');setSecret('');setError('');setDone('');void load();}}>{t('reloadSettings')}</button>{error?<p role="alert" className="error">{error}</p>:null}{done?<p role="status">{done}</p>:null}
 {data?<form onSubmit={save} className="panel settings-form" autoComplete="off">
   <p>{t('stripeAccount')}: {data.account_id??'—'} · {data.mode?data.mode==='live'?t('stripeLive'):t('stripeTest'):'—'}</p>
   {!data.server_ready?<p className="error">{t('stripeServerMissing')}</p>:null}
   <SecretField label={t('stripeSecretKey')} value={key} onChange={setKey} required={!data.key_configured} check={keyShown}/>
   {modeNote?<p className="key-check warn">! {t(modeNote.key, modeNote.params)}</p>:null}
   <SecretField label={t('stripeWebhookSecret')} value={secret} onChange={setSecret} required={!data.webhook_configured} check={webhookCheck}/>
   {pairMissing?<p className="key-check warn">! {t('keysBothNeeded')}</p>:null}
   <p className="muted">{t('stripeKeepSecret')}</p>
   <label className="payment-setting-toggle"><input type="checkbox" checked={card} onChange={e=>setCard(e.target.checked)}/>{t('stripeCard')}</label>
   <label className="payment-setting-toggle"><input type="checkbox" checked={qr} onChange={e=>setQr(e.target.checked)}/>{t('stripeQr')}</label>
   <p>{t('stripeDashboardHint')}</p>
   <button className="primary" type="submit" disabled={busy||!data.server_ready||blocked}>{busy?t('saving'):t('save')}</button>
   <h2>{t('stripeWebhookEndpoint')}</h2><p><code>{endpoint}</code></p><p className="muted">{t('stripeWebhookHint')}</p>
   <p>{t('stripeTransferKept')}: {data.transfer_configured?t('stripeConfigured'):t('stripeNotConfigured')}</p>
 </form>:null}</>;
}
