/**
 * Thai QR (PromptPay credit transfer, EMVCo merchant-presented) with the invoice amount built in.
 * The shop scans it in any banking app, pays our own PromptPay account and sends the slip, which
 * EasySlip checks against the invoice like a normal transfer. No payment provider is involved.
 */
const field = (id: string, value: string) => `${id}${String(value.length).padStart(2, '0')}${value}`;

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF), as EMVCo requires for tag 63. */
export function crc16(text: string): string {
  let crc = 0xffff;
  for (const byte of Buffer.from(text, 'utf8')) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** PromptPay target: mobile 0XXXXXXXXX → tag 01 (0066…), 13-digit tax/citizen ID → tag 02, 15-digit e-wallet → tag 03. */
function target(promptPayId: string): string | null {
  const digits = promptPayId.replace(/\D/g, '');
  if (/^0\d{9}$/.test(digits)) return field('01', `0066${digits.slice(1)}`);
  if (/^\d{13}$/.test(digits)) return field('02', digits);
  if (/^\d{15}$/.test(digits)) return field('03', digits);
  return null;
}

/** Payload for one invoice amount in THB; null when the PromptPay ID is not a usable number. */
export function promptPayPayload(promptPayId: string, amountMinor: number): string | null {
  const account = target(promptPayId);
  if (!account || !Number.isSafeInteger(amountMinor) || amountMinor <= 0) return null;
  const body = field('00', '01') + field('01', '12') + field('29', field('00', 'A000000677010111') + account)
    + field('53', '764') + field('54', (amountMinor / 100).toFixed(2)) + field('58', 'TH') + '6304';
  return body + crc16(body);
}
