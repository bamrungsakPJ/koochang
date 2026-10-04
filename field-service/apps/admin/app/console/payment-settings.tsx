'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { call, ConsoleError, useStepUp, useText } from './api';
interface Settings { version:number;account_id?:string;mode?:'test'|'live';credential_id?:string;card_enabled:boolean;qr_enabled:boolean;
  key_configured:boolean;webhook_configured:boolean;webhook_path:string|null;next_credential_id:string;next_webhook_path:string;server_ready:boolean;transfer_configured:boolean }
export function PaymentSettingsView(){
 const t=useText(),step=useStepUp();
 const [data,setData]=useState<Settings|null>(null),[card,setCard]=useState(false),[qr,setQr]=useState(false);
 const [key,setKey]=useState(''),[secret,setSecret]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState('');
 const apply=(s:Settings)=>{setData(s);setCard(s.card_enabled);setQr(s.qr_enabled);};
 const load=()=>call<Settings>('GET','/platform/payment-settings').then(apply,e=>setError(e.message));
 useEffect(()=>{void load();},[]);
 async function save(e:FormEvent){e.preventDefault();if(!data||busy)return;setBusy(true);setError('');setDone('');
   try{const value=await step(()=>call<Settings>('POST','/platform/payment-settings',{version:data.version,credential_id:data.next_credential_id,secret_key:key||undefined,webhook_secret:secret||undefined,card_enabled:card,qr_enabled:qr}));apply(value);setKey('');setSecret('');setDone(t('saved'));}
   catch(e){setError(e instanceof ConsoleError&&e.code==='VALIDATION_ERROR'?t('settingsReview'):e instanceof Error?e.message:t('settingsError'));}finally{setBusy(false);}
 }
 const endpoint=data?`${(process.env.NEXT_PUBLIC_API_URL??'http://localhost:4000').replace(/\/$/,'')}${key||secret||!data.webhook_path?data.next_webhook_path:data.webhook_path}`:'';
 return <><h1>{t('paymentSettings')}</h1><p>{t('stripeSettingsHint')}</p><button className="ghost" disabled={busy} onClick={()=>{setKey('');setSecret('');setError('');setDone('');void load();}}>{t('reloadSettings')}</button>{error?<p role="alert" className="error">{error}</p>:null}{done?<p role="status">{done}</p>:null}
 {data?<form onSubmit={save} className="panel settings-form">
   <p>{t('stripeAccount')}: {data.account_id??'—'} · {data.mode?data.mode==='live'?t('stripeLive'):t('stripeTest'):'—'}</p>
   {!data.server_ready?<p className="error">{t('stripeServerMissing')}</p>:null}
   <label>{t('stripeSecretKey')}<input type="password" autoComplete="new-password" value={key} required={!data.key_configured} onChange={e=>setKey(e.target.value)} maxLength={500}/></label>
   <label>{t('stripeWebhookSecret')}<input type="password" autoComplete="new-password" value={secret} required={!data.webhook_configured} onChange={e=>setSecret(e.target.value)} maxLength={500}/></label>
   <p className="muted">{t('stripeKeepSecret')}</p>
   <label className="payment-setting-toggle"><input type="checkbox" checked={card} onChange={e=>setCard(e.target.checked)}/>{t('stripeCard')}</label>
   <label className="payment-setting-toggle"><input type="checkbox" checked={qr} onChange={e=>setQr(e.target.checked)}/>{t('stripeQr')}</label>
   <p>{t('stripeDashboardHint')}</p>
   <button className="primary" type="submit" disabled={busy||!data.server_ready}>{busy?t('saving'):t('save')}</button>
   <h2>{t('stripeWebhookEndpoint')}</h2><p><code>{endpoint}</code></p><p className="muted">{t('stripeWebhookHint')}</p>
   <p>{t('stripeTransferKept')}: {data.transfer_configured?t('stripeConfigured'):t('stripeNotConfigured')}</p>
 </form>:null}</>;
}
