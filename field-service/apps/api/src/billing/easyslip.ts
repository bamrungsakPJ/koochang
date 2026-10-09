/** EasySlip v2. Never accepts a client verdict or follows a provider redirect. */
export interface SlipOrder { id: string; amount_minor: string | number; created_at: string | Date;
  receiver: { bankCode?: string; accountNumber?: string; promptPayId?: string } | null }
export type SlipResult = { code: string; reference?: string; receivedAt?: string; amountMinor?: number };
const digits = (value: unknown) => typeof value === 'string' && /^[\d -]+$/.test(value) ? value.replace(/[ -]/g, '') : '';
const minor = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0 &&
  Math.abs(value * 100 - Math.round(value * 100)) < 0.000001 ? Math.round(value * 100) : NaN;
// EasySlip also uses name similarity. Corroborate the visible account digits, not just a matched name.
// Banks mask differently: KBank keeps the full length (xxx-x-x9956-x), SCB shows only the tail (x-9956), so a
// shorter mask is compared right-aligned with the end of the account number.
export function matchesMasked(value: unknown, expected: string | undefined): boolean {
  if (typeof value !== 'string') return false;
  const actual = value.replace(/[ -]/g, '').toLowerCase(), number = digits(expected);
  if (!number || !/^[\dx*]+$/.test(actual) || actual.length > number.length || (actual.match(/\d/g)?.length ?? 0) < 4) return false;
  const offset = number.length - actual.length;
  return [...actual].every((c, i) => c === 'x' || c === '*' || c === number[offset + i]);
}

export class EasySlip {
  constructor(private readonly key: string | undefined = process.env.EASYSLIP_API_KEY, private readonly request: typeof fetch = fetch) {}
  async verify(image: Buffer, order: SlipOrder): Promise<SlipResult> {
    if (!this.key || !/^\d{3}$/.test(order.receiver?.bankCode ?? '') || !digits(order.receiver?.accountNumber)) return { code: 'CONFIGURATION' };
    if (image.length > 4_194_304) return { code: 'IMAGE_SIZE_TOO_LARGE' };
    const body = new FormData();
    body.append('image', new Blob([new Uint8Array(image)], { type: 'image/jpeg' }), 'slip.jpg');
    body.append('remark', order.id); body.append('matchAccount', 'true'); body.append('checkDuplicate', 'true');
    body.append('matchAmount', String(Number(order.amount_minor) / 100));
    try {
      const response = await this.request('https://api.easyslip.com/v2/verify/bank', {
        method: 'POST', headers: { Authorization: `Bearer ${this.key}` }, body, redirect: 'error', signal: AbortSignal.timeout(20_000),
      });
      const result = await response.json();
      if (!response.ok || result.success !== true) {
        const code = result.error?.code;
        return { code: ['SLIP_NOT_FOUND', 'SLIP_PENDING', 'IMAGE_SIZE_TOO_LARGE', 'INVALID_IMAGE_FORMAT', 'QUOTA_EXCEEDED'].includes(code) ? code : 'UNAVAILABLE' };
      }
      const data = result.data, slip = data?.rawSlip;
      if (!data || !slip || typeof data.isDuplicate !== 'boolean') return { code: 'INVALID_RESPONSE' };
      if (data.isDuplicate) return { code: 'DUPLICATE' };
      if (data.isAmountMatched !== true || minor(data.amountInSlip) !== Number(order.amount_minor) || minor(slip.amount?.amount) !== Number(order.amount_minor)) return { code: 'AMOUNT_MISMATCH' };
      // Which receiver check failed goes to the log (our own account details only, never the sender's).
      const mismatch = (step: string) => { console.warn(`SLIP_RECEIVER_MISMATCH ${step} matched=${data.matchedAccount ? `${data.matchedAccount.bank?.code ?? '-'}/${String(data.matchedAccount.bankNumber ?? '-').slice(-4)}` : 'none'} slipBank=${slip.receiver?.bank?.id ?? '-'} slipAccount=${String(slip.receiver?.account?.bank?.account ?? slip.receiver?.account?.proxy?.account ?? '-').slice(0, 20)}`); return { code: 'RECEIVER_MISMATCH' }; };
      if (!data.matchedAccount) return mismatch('no_matched_account');
      if (data.matchedAccount.bank?.code !== order.receiver!.bankCode || slip.receiver?.bank?.id !== order.receiver!.bankCode) return mismatch('bank');
      if (digits(data.matchedAccount.bankNumber) !== digits(order.receiver!.accountNumber)) return mismatch('account_number');
      const account = slip.receiver?.account;
      if (!matchesMasked(account?.bank?.account, order.receiver!.accountNumber) &&
        !(['NATID', 'MSISDN'].includes(account?.proxy?.type) && matchesMasked(account?.proxy?.account, order.receiver!.promptPayId))) return mismatch('masked_account');
      if (slip.countryCode !== 'TH' || (slip.amount?.local?.currency && !['THB', '764'].includes(slip.amount.local.currency))) return { code: 'CURRENCY_MISMATCH' };
      const at = typeof slip.date === 'string' ? Date.parse(slip.date) : NaN;
      if (!Number.isFinite(at) || at < new Date(order.created_at).getTime() || at > Date.now() + 60_000) return { code: 'DATE_MISMATCH' };
      if (typeof slip.transRef !== 'string' || !/^[A-Za-z0-9-]{1,80}$/.test(slip.transRef)) return { code: 'INVALID_RESPONSE' };
      // Persist only the evidence needed for reconciliation, never sender names or raw QR data.
      return { code: 'VERIFIED', reference: slip.transRef.toUpperCase(), receivedAt: new Date(at).toISOString(), amountMinor: Number(order.amount_minor) };
    } catch { return { code: 'UNAVAILABLE' }; }
  }
}
