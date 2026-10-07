// Only enrich the dedicated, disposable screenshot database after its QA server starts.
import pg from 'pg';
import { hashPassword } from '../apps/api/dist/platform/secrets.js';
const url = new URL(process.env.TEST_DATABASE_URL);
if (!['127.0.0.1','localhost'].includes(url.hostname) || !url.pathname.endsWith('_test')) throw Error('TEST_DATABASE_REQUIRED');
url.pathname=url.pathname.replace(/_test$/,'_owner_web_test');
const pool=new pg.Pool({connectionString:url.toString()});
const org='20000000-0000-0000-0000-000000000001',owner='10000000-0000-0000-0000-000000000001',tech='10000000-0000-0000-0000-000000000003',member='30000000-0000-0000-0000-000000000003';
try {
 await pool.query("UPDATE core.users SET display_name='คุณต้น',phone_e164='+66900000001',phone_verified_at=now() WHERE id=$1",[owner]);
 await pool.query("UPDATE core.users SET display_name='ช่างนนท์',phone_e164='+66900000003',phone_verified_at=now() WHERE id=$1",[tech]);
 for(const id of [owner,tech]) await pool.query('INSERT INTO auth.user_passwords(user_id,password_hash) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET password_hash=excluded.password_hash',[id,await hashPassword('KooChangDemo2026!')]);
 await pool.query("UPDATE core.organizations SET name='ร้านคู่ช่างเซอร์วิส · สาธิต' WHERE id=$1",[org]);
 await pool.query("UPDATE core.organization_members SET display_name=CASE WHEN role='owner' THEN 'คุณต้น' ELSE 'ช่างนนท์' END WHERE organization_id=$1",[org]);
 await pool.query("UPDATE core.customers SET name='ร้านกาแฟริมสวน · สาธิต' WHERE organization_id=$1",[org]);
 await pool.query("UPDATE core.customer_locations SET name='สาขาบางบัวทอง',address='สถานที่ตัวอย่าง อำเภอบางบัวทอง นนทบุรี',travel_note='เข้าทางประตูด้านหน้า โทรแจ้งก่อนเข้าบริการ' WHERE organization_id=$1",[org]);
 await pool.query("UPDATE core.equipment SET name='แอร์ผนัง · ห้องรับรอง',brand='DEMO AIR',model='DA-12000',serial_number='DEMO-0001' WHERE organization_id=$1",[org]);
 for(const [i,title,status] of [[1,'ล้างแอร์ร้านกาแฟริมสวน','scheduled'],[2,'ตรวจเช็กแอร์ห้องรับรอง','in_progress'],[3,'บริการบำรุงรักษารอบเดือน','scheduled']]){
  const job=(await pool.query("INSERT INTO core.jobs(organization_id,customer_id,location_id,title,job_type,status,current_assignee_id,scheduled_start,scheduled_end,started_at,description) VALUES($1,'40000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',$2,'maintenance',$3,$4,date_trunc('day',now())+make_interval(hours=>$5),date_trunc('day',now())+make_interval(hours=>$5+2),CASE WHEN $3='in_progress' THEN now() ELSE NULL END,'ตรวจเช็กการทำงาน ล้างแผ่นกรองและบันทึกผลก่อน–หลัง') RETURNING id",[org,title,status,member,8+i*2])).rows[0].id;
  await pool.query("INSERT INTO core.job_assignments(organization_id,job_id,member_id,assigned_by) VALUES($1,$2,$3,$4)",[org,job,member,owner]);
  await pool.query("INSERT INTO core.job_equipment(organization_id,job_id,equipment_id,location_id,requested_service_type) VALUES($1,$2,'60000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001','maintenance')",[org,job]);
 }
 console.log('Synthetic screenshot fixture ready; owner 0900000001, technician 0900000003. Test password: KooChangDemo2026!');
} finally {await pool.end();}
