'use client';
import { useEffect, useState, type FormEvent } from 'react';
import type { Language } from '@field-service/core';
import { call, ConsoleError, dateTime, useLanguage, useStepUp, useText, type Me } from './api';
type Section='bank'|'sms'|'easyslip'|'ocr';
interface Config {
 ocr:{enabled:boolean;key_configured:boolean;model:string};ocr_worker_ready:boolean;version:number;server_ready:boolean;slip_worker_ready:boolean;
 bank:{enabled:boolean;bankName:string;bankCode:string;accountName:string;accountNumber:string;promptPayId?:string}|null;
 sms:{enabled:boolean;sender:string;key_configured:boolean};easyslip:{enabled:boolean;key_configured:boolean};
}
export function PlatformSettingsView(){
 const t=useText(),step=useStepUp();
 const [data,setData]=useState<Config|null>(null),[section,setSection]=useState<Section>('bank');
 const [enabled,setEnabled]=useState(false),[values,setValues]=useState<Record<string,string>>({}),[key,setKey]=useState(''),[secret,setSecret]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState('');
 const load=()=>call<Config>('GET','/platform/settings').then(setData,e=>setError(e instanceof Error?e.message:t('settingsError')));
 useEffect(()=>{void load();},[]);
 useEffect(()=>{if(!data)return;const selected=data[section];setEnabled(Boolean(selected?.enabled));setKey('');setSecret('');
   setValues(section==='bank'?{bankName:data.bank?.bankName??'',bankCode:data.bank?.bankCode??'',accountName:data.bank?.accountName??'',accountNumber:data.bank?.accountNumber??'',promptPayId:data.bank?.promptPayId??''}:section==='ocr'?{model:data.ocr.model}:{sender:data.sms.sender});
 },[data,section]);
 async function save(e:FormEvent){e.preventDefault();if(!data||busy)return;setBusy(true);setError('');setDone('');
   try{setData(await step(()=>call<Config>('POST','/platform/settings',{version:data.version,section,enabled,...values,api_key:key||undefined,secret_key:secret||undefined})));setDone(t('saved'));}
   catch(e){setError(e instanceof ConsoleError&&e.code==='VALIDATION_ERROR'?t('settingsReview'):e instanceof Error?e.message:t('settingsError'));}finally{setBusy(false);}
 }
 const configured=section==='sms'?data?.sms.key_configured:section==='ocr'?data?.ocr.key_configured:data?.easyslip.key_configured;
 return <><h1>{t('platformSettings')}</h1><p className="muted">{t('settingsHint')}</p>
 <div className="actions">{(['bank','sms','easyslip','ocr'] as const).map(s=><button type="button" className={section===s?'primary':'ghost'} disabled={busy} key={s} onClick={()=>{setSection(s);setError('');setDone('');}}>{t(s==='bank'?'bankSettings':s==='sms'?'smsSettings':s==='ocr'?'ocrSettings':'slipSettings')}</button>)}<button type="button" className="ghost" disabled={busy} onClick={()=>{setError('');setDone('');void load();}}>{t('reloadSettings')}</button></div>
 {error?<p className="error" role="alert">{error}</p>:null}{done?<p role="status">{done}</p>:null}
 {data?<form className="panel settings-form" onSubmit={save}>
 <h2>{t(section==='bank'?'bankSettings':section==='sms'?'smsSettings':section==='ocr'?'ocrSettings':'slipSettings')}</h2>
 <label className="check"><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/>{t('enableService')}</label>
 {section==='bank'?<><div className="grid2">{(['bankName','bankCode','accountName','accountNumber','promptPayId'] as const).map(name=><label key={name}>{t(name)}<input value={values[name]??''} onChange={e=>setValues({...values,[name]:e.target.value})} required={enabled&&name!=='promptPayId'} maxLength={name==='bankCode'?3:name==='promptPayId'?20:150} inputMode={['bankCode','accountNumber','promptPayId'].includes(name)?'numeric':undefined}/></label>)}</div><p className="muted">{t('bankSnapshotHint')}</p></>:<>
 <p>{t(configured?'providerConfigured':'providerMissing')}</p>
 {section==='sms'?<label>{t('smsSender')}<input value={values.sender??''} required={enabled} maxLength={100} onChange={e=>setValues({...values,sender:e.target.value})}/></label>:null}
 {section==='ocr'?<><label>{t('ocrModel')}<input value={values.model??''} required maxLength={100} onChange={e=>setValues({...values,model:e.target.value})}/></label><p role="status">{t(data.ocr.enabled&&configured&&data.ocr_worker_ready?'ocrReady':'ocrNotReady')}</p></>:null}
 <label>{t('providerKey')}<input type="password" autoComplete="new-password" value={key} onChange={e=>setKey(e.target.value)} required={enabled&&!configured} maxLength={500}/></label>
 {section==='sms'?<label>{t('providerSecret')}<input type="password" autoComplete="new-password" value={secret} onChange={e=>setSecret(e.target.value)} required={Boolean(key)||(enabled&&!configured)} maxLength={500}/></label>:null}
 <p className="muted">{t('keepProviderKeys')}</p><p>{t(section==='sms'?'enableSmsHint':section==='ocr'?'enableOcrHint':'enableSlipHint')}</p>
 {!data.server_ready?<p className="error">{t('settingsEncryptionMissing')}</p>:null}
 {section==='easyslip'&&!data.slip_worker_ready?<p className="error">{t('slipWorkerMissing')}</p>:null}
 </>}
 <button className="primary" disabled={busy||Boolean(section!=='bank'&&!data.server_ready)}>{busy?t('saving'):t('save')}</button>
 </form>:<p>…</p>}</>;
}
interface AccountData {profile:{version:number;display_name:string;email:string;preferred_language:Language;mfa_enrolled:boolean};sessions:{id:string;created_at:string;expires_at:string;client:string|null;current:boolean}[]}
function clientName(client:string|null){
 if(!client)return '—';
 const browser=/Edg\//.test(client)?'Edge':/Firefox\//.test(client)?'Firefox':/Chrome\//.test(client)?'Chrome':/Safari\//.test(client)?'Safari':null;
 const device=/Android/.test(client)?'Android':/iPhone|iPad/.test(client)?'iOS':/Windows/.test(client)?'Windows':/Macintosh/.test(client)?'macOS':/Linux/.test(client)?'Linux':null;
 return browser?[browser,device].filter(Boolean).join(' · '):client.slice(0,80);
}
export function AccountSettingsView({onUpdated}:{onUpdated:(me:Me)=>void}){
 const t=useText(),lang=useLanguage(),step=useStepUp();
 const [data,setData]=useState<AccountData|null>(null),[name,setName]=useState(''),[language,setLanguage]=useState<Language>('th');
 const [current,setCurrent]=useState(''),[next,setNext]=useState(''),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState('');
 function apply(d:AccountData){setData(d);setName(d.profile.display_name);setLanguage(d.profile.preferred_language);}
 const load=()=>call<AccountData>('GET','/platform/account').then(apply,e=>setError(e instanceof Error?e.message:t('settingsError')));
 useEffect(()=>{void load();},[]);
 async function action(kind:'profile'|'password'|'logout-others'){
   if(!data||busy)return;if(kind==='password'&&next!==confirm){setError(t('passwordMismatch'));return;}
   setBusy(true);setError('');setDone('');
   try{
     const body=kind==='profile'?{version:data.profile.version,display_name:name,preferred_language:language}:kind==='password'?{current_password:current,new_password:next}:undefined;
     const work=()=>call<AccountData>('POST',`/platform/account/${kind}`,body);
     const result=kind==='profile'?await work():await step(work);apply(result);
     if(kind==='profile')onUpdated(await call<Me>('GET','/platform/auth/me'));
     setCurrent('');setNext('');setConfirm('');setDone(t(kind==='profile'?'saved':'securitySaved'));
   }catch(e){setError(e instanceof ConsoleError&&e.code==='VALIDATION_ERROR'?t('settingsReview'):e instanceof Error?e.message:t('settingsError'));}finally{setBusy(false);}
 }
 return <><h1>{t('accountSettings')}</h1>{error?<p className="error" role="alert">{error}</p>:null}{done?<p role="status">{done}</p>:null}
 <button className="ghost" disabled={busy} onClick={()=>{void load();}}>{t('reloadSettings')}</button>
 {data?<><form className="panel settings-form" onSubmit={e=>{e.preventDefault();void action('profile');}}>
 <label>{t('email')}<input type="email" value={data.profile.email} readOnly/></label><p className="muted">{t('accountEmailHint')}</p>
 <label>{t('profileName')}<input value={name} required maxLength={100} onChange={e=>setName(e.target.value)}/></label>
 <label>{t('profileLanguage')}<select value={language} onChange={e=>setLanguage(e.target.value as Language)}><option value="th">ไทย</option><option value="en">English</option></select></label>
 <button className="primary" disabled={busy}>{t('save')}</button></form>
 <form className="panel settings-form" onSubmit={e=>{e.preventDefault();void action('password');}}><h2>{t('changePassword')}</h2><p className="muted">{t('passwordHint')}</p>
 <label>{t('currentPassword')}<input type="password" autoComplete="current-password" value={current} onChange={e=>setCurrent(e.target.value)} required maxLength={200}/></label>
 <label>{t('newPassword')}<input type="password" autoComplete="new-password" value={next} onChange={e=>setNext(e.target.value)} required minLength={12} maxLength={200}/></label>
 <label>{t('confirmPassword')}<input type="password" autoComplete="new-password" value={confirm} onChange={e=>setConfirm(e.target.value)} required minLength={12} maxLength={200}/></label>
 <button className="primary" disabled={busy}>{t('changePassword')}</button></form>
 <section className="panel"><h2>{t('sessionsTitle')}</h2><div className="settings-table"><table><thead><tr><th>{t('sessionClient')}</th><th>{t('sessionStarted')}</th><th>{t('sessionExpires')}</th></tr></thead><tbody>{data.sessions.map(s=><tr key={s.id}><td>{s.current?<strong>{t('currentSession')} · </strong>:null}{clientName(s.client)}</td><td>{dateTime(s.created_at,lang)}</td><td>{dateTime(s.expires_at,lang)}</td></tr>)}</tbody></table></div>
 <button className="danger" disabled={busy||!data.sessions.some(s=>!s.current)} onClick={()=>{void action('logout-others');}}>{t('logoutOthers')}</button></section></>:<p>…</p>}</>;
}
