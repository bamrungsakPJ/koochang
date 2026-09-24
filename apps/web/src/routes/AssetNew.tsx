import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { api, type UploadedMedia } from '../api/client';
import type { AssetDetail, Category, CustomerDetail } from '../api/types';
import { CustomerPicker, type PickedCustomer } from '../components/CustomerPicker';
import { Chips, PhotoPicker } from '../components/domain';
import { Button, Card, ErrorText, Field, Input, errorMessage } from '../components/ui';

type Location = { lat: number; lng: number };

/**
 * "Add installed asset" in ~10–20 s (req §8): customer → nameplate photo → category → site → done.
 * Brand / model / serial are optional and can be filled in later.
 */
export function AssetNew({ basePath }: { basePath: '/admin' | '/tech' }) {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const presetCustomerId = params.get('customerId');

  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [photos, setPhotos] = useState<UploadedMedia[]>([]);
  const [categoryId, setCategoryId] = useState<string[]>([]);
  const [brand, setBrand] = useState('');
  const [model, setModel] = useState('');
  const [serial, setSerial] = useState('');
  const [siteChoice, setSiteChoice] = useState<string[]>([]);
  const [location, setLocation] = useState<Location | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState('');

  const preset = useQuery({
    queryKey: ['customer', presetCustomerId],
    queryFn: () => api<CustomerDetail>(`/customers/${presetCustomerId}`),
    enabled: Boolean(presetCustomerId),
  });
  const existingId = customer?.kind === 'existing' ? customer.id : presetCustomerId;
  const customerDetail = useQuery({
    queryKey: ['customer', existingId],
    queryFn: () => api<CustomerDetail>(`/customers/${existingId}`),
    enabled: Boolean(existingId),
  });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api<Category[]>('/asset-categories') });

  const effectiveCustomer: PickedCustomer | null =
    customer ??
    (preset.data ? { kind: 'existing', id: preset.data.id, displayName: preset.data.displayName, phone: preset.data.phone } : null);
  const sites = customerDetail.data?.sites ?? [];

  const create = useMutation({
    mutationFn: () => {
      const c = effectiveCustomer!;
      const useNewSite = location && (siteChoice[0] === 'here' || sites.length === 0);
      return api<AssetDetail>('/assets', {
        method: 'POST',
        body: {
          ...(c.kind === 'existing' ? { customerId: c.id } : { newCustomer: { displayName: c.displayName, phone: c.phone } }),
          ...(useNewSite ? { newSite: { lat: location.lat, lng: location.lng } } : {}),
          ...(!useNewSite && siteChoice[0] && siteChoice[0] !== 'here' ? { siteId: siteChoice[0] } : {}),
          categoryId: categoryId[0],
          brand: brand || undefined,
          model: model || undefined,
          serialNumber: serial || undefined,
          primaryMediaId: photos[0]?.id,
        },
      });
    },
    onSuccess: (a) => navigate(`${basePath}/assets/${a.id}`, { replace: true }),
  });

  function locate() {
    setLocError('');
    if (!navigator.geolocation) {
      setLocError('อุปกรณ์นี้ไม่รองรับการระบุตำแหน่ง');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setSiteChoice(['here']);
        setLocating(false);
      },
      () => {
        setLocError('ระบุตำแหน่งไม่ได้ — ข้ามได้ ไม่บังคับ');
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  if (!effectiveCustomer) {
    return (
      <div className="mx-auto max-w-lg space-y-4">
        <h1 className="text-2xl font-semibold">เพิ่มเครื่องที่ติดตั้ง</h1>
        <p className="text-slate-600">1. เลือกลูกค้า</p>
        {presetCustomerId && preset.isPending ? <p className="text-slate-500">กำลังโหลด…</p> : <CustomerPicker onPick={setCustomer} />}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-5 pb-24">
      <h1 className="text-2xl font-semibold">เพิ่มเครื่องที่ติดตั้ง</h1>

      <Card className="flex items-center justify-between gap-3 py-3">
        <div>
          <p className="text-xs text-slate-500">ลูกค้า{effectiveCustomer.kind === 'new' ? ' (ใหม่)' : ''}</p>
          <p className="font-medium">{effectiveCustomer.displayName}</p>
        </div>
        {!presetCustomerId && (
          <button className="text-sm text-brand-700 hover:underline" onClick={() => setCustomer(null)}>
            เปลี่ยน
          </button>
        )}
      </Card>

      <section className="space-y-2">
        <h2 className="font-medium">📷 รูปป้ายเครื่อง (Nameplate)</h2>
        <PhotoPicker kind="NAMEPLATE" photos={photos} onChange={setPhotos} max={1} label="ถ่ายป้าย" />
      </section>

      <section className="space-y-2">
        <h2 className="font-medium">ประเภทเครื่อง</h2>
        <Chips
          options={(categories.data ?? []).map((c) => ({ value: c.id, label: c.name }))}
          value={categoryId}
          onChange={setCategoryId}
        />
      </section>

      <details className="rounded-2xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer font-medium">ยี่ห้อ / รุ่น / Serial <span className="text-sm font-normal text-slate-500">(ไม่บังคับ — ใส่ทีหลังได้)</span></summary>
        <div className="mt-4 space-y-3">
          <Field label="ยี่ห้อ">
            <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="เช่น Daikin" />
          </Field>
          <Field label="รุ่น">
            <Input value={model} onChange={(e) => setModel(e.target.value)} />
          </Field>
          <Field label="Serial">
            <Input value={serial} onChange={(e) => setSerial(e.target.value)} />
          </Field>
        </div>
      </details>

      <section className="space-y-2">
        <h2 className="font-medium">📍 สถานที่</h2>
        {sites.length > 0 && (
          <Chips
            options={[
              ...sites.map((s) => ({ value: s.id, label: s.displayName })),
              ...(location ? [{ value: 'here', label: 'ตำแหน่งปัจจุบัน (ใหม่)' }] : []),
            ]}
            value={siteChoice}
            onChange={setSiteChoice}
          />
        )}
        {location && sites.length === 0 && <p className="text-sm text-emerald-700">✓ บันทึกตำแหน่งปัจจุบันแล้ว</p>}
        <Button variant="secondary" loading={locating} onClick={locate}>
          ใช้ตำแหน่งปัจจุบัน
        </Button>
        {locError && <p className="text-sm text-slate-500">{locError}</p>}
      </section>

      <ErrorText>{create.error && errorMessage(create.error)}</ErrorText>
      <div className="fixed inset-x-0 bottom-0 border-t border-slate-200 bg-white/95 p-4 backdrop-blur">
        <div className="mx-auto max-w-lg">
          <Button className="w-full" loading={create.isPending} onClick={() => create.mutate()}>
            ติดตั้งเสร็จ
          </Button>
        </div>
      </div>
    </div>
  );
}
