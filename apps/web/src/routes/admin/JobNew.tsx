import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api } from '../../api/client';
import type { AssetDetail, CustomerDetail, JobDetail, Member } from '../../api/types';
import { CustomerPicker } from '../../components/CustomerPicker';
import { Chips } from '../../components/domain';
import { Button, Card, ErrorText, Field, Input, errorMessage } from '../../components/ui';

const GENERIC_ISSUES = ['เสีย/ใช้งานไม่ได้', 'มีเสียงดัง', 'ตรวจเช็ก/บำรุงรักษา', 'อื่น ๆ'];

/** Target: a job for an existing customer in under 30 seconds (req §40). */
export function JobNew() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [customerId, setCustomerId] = useState(params.get('customerId'));
  const [assetId, setAssetId] = useState(params.get('assetId'));
  const [issue, setIssue] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [assignee, setAssignee] = useState('');

  const asset = useQuery({
    queryKey: ['asset', assetId],
    queryFn: () => api<AssetDetail>(`/assets/${assetId}`),
    enabled: Boolean(assetId),
  });
  const effectiveCustomerId = customerId ?? asset.data?.customer.id ?? null;
  const customer = useQuery({
    queryKey: ['customer', effectiveCustomerId],
    queryFn: () => api<CustomerDetail>(`/customers/${effectiveCustomerId}`),
    enabled: Boolean(effectiveCustomerId),
  });
  const members = useQuery({ queryKey: ['members'], queryFn: () => api<Member[]>('/memberships') });
  const technicians = (members.data ?? []).filter((m) => m.role === 'TECHNICIAN');

  const create = useMutation({
    mutationFn: () =>
      api<JobDetail>('/jobs', {
        method: 'POST',
        body: {
          ...(assetId ? { assetId } : { customerId: effectiveCustomerId }),
          issueType: issue[0],
          issueNote: note || undefined,
          assigneeId: assignee || undefined,
        },
      }),
    onSuccess: (j) => navigate(`/admin/jobs/${j.id}`, { replace: true }),
  });

  const issueTypes = asset.data?.category?.issueTypes.length ? asset.data.category.issueTypes : GENERIC_ISSUES;

  return (
    <div className="mx-auto max-w-lg space-y-5">
      <h1 className="text-2xl font-semibold">สร้างงาน</h1>

      {!effectiveCustomerId ? (
        <section className="space-y-2">
          <h2 className="font-medium">ลูกค้า</h2>
          <CustomerPicker
            onPick={async (c) => {
              if (c.kind === 'existing') setCustomerId(c.id);
              else {
                const created = await api<CustomerDetail>('/customers', {
                  method: 'POST',
                  body: { displayName: c.displayName, phone: c.phone },
                });
                setCustomerId(created.id);
              }
            }}
          />
        </section>
      ) : (
        <>
          <Card className="flex items-center justify-between gap-3 py-3">
            <div>
              <p className="text-xs text-slate-500">ลูกค้า</p>
              <p className="font-medium">{customer.data?.displayName ?? '…'}</p>
              {customer.data?.phone && <p className="text-sm text-slate-500">{customer.data.phone}</p>}
            </div>
            {!params.get('assetId') && !params.get('customerId') && (
              <button
                className="text-sm text-brand-700 hover:underline"
                onClick={() => {
                  setCustomerId(null);
                  setAssetId(null);
                }}
              >
                เปลี่ยน
              </button>
            )}
          </Card>

          <section className="space-y-2">
            <h2 className="font-medium">เครื่อง</h2>
            {customer.data && customer.data.assets.length === 0 && (
              <p className="text-sm text-slate-500">ลูกค้ายังไม่มีเครื่องในระบบ — สร้างงานได้เลย แล้วช่างเพิ่มเครื่องหน้างาน</p>
            )}
            <Chips
              options={(customer.data?.assets ?? []).map((a) => ({
                value: a.id,
                label: [a.brand, a.model].filter(Boolean).join(' ') || a.category || 'เครื่อง',
              }))}
              value={assetId ? [assetId] : []}
              onChange={(v) => {
                setAssetId(v[0] ?? null);
                setIssue([]);
              }}
            />
          </section>

          <section className="space-y-2">
            <h2 className="font-medium">อาการ</h2>
            <Chips options={issueTypes.map((t) => ({ value: t, label: t }))} value={issue} onChange={setIssue} />
            <Input placeholder="รายละเอียดเพิ่มเติม (ไม่บังคับ)" value={note} onChange={(e) => setNote(e.target.value)} />
          </section>

          <Field label="มอบหมายช่าง (ไม่บังคับ)">
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              className="min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3"
            >
              <option value="">— มอบหมายทีหลัง —</option>
              {technicians.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </Field>

          <ErrorText>{create.error && errorMessage(create.error)}</ErrorText>
          <Button className="w-full" loading={create.isPending} onClick={() => create.mutate()}>
            สร้างงาน
          </Button>
        </>
      )}
    </div>
  );
}
