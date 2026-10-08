import Stripe from 'stripe';
import type { Pool } from 'pg';
import { decrypt } from '../shared/crypto.js';
import type { StripeConfig } from './stripe.service.js';

/** Automatic card renewal, run by the worker. Each due shop gets a renewal invoice and one
 * off-session PaymentIntent on its saved card; the result goes through worker.finish_autopay,
 * which records the payment and the next period exactly like a Checkout payment. */
export interface AutopayDeps {
  pool: Pick<Pool, 'query'>; secretKey?: Buffer; production: boolean;
  client?: (key: string) => Pick<Stripe, 'paymentIntents'>; log?: (message: string) => void;
}
interface Charge { id: string; organization_id: string; invoice_id: string; credential_id: string; amount_minor: string | number;
  number: string; customer_id: string; payment_method_id: string; payment_intent: string | null; status: string }

/** Declines that will not pass on a retry: stop automatic renewal so the owner pays and saves a new card. */
const hardStops = new Set(['authentication_required', 'expired_card', 'lost_card', 'stolen_card', 'card_not_supported', 'pickup_card',
  'restricted_card', 'invalid_account', 'currency_not_supported', 'resource_missing', 'payment_method_unactivated']);

export async function runAutopay(deps: AutopayDeps, at = new Date(), limit = 10): Promise<number> {
  if (!deps.secretKey) return 0;
  const current: StripeConfig | null = (await deps.pool.query('SELECT worker.stripe_config(NULL) AS value')).rows[0]?.value ?? null;
  // A test key must never charge on production, and charging stops when the platform turns cards off.
  if (!current?.card_enabled || (deps.production && current.mode !== 'live')) return 0;
  for (const row of (await deps.pool.query('SELECT worker.autopay_pending(120) AS v')).rows) await charge(deps, row.v);
  let charged = 0;
  for (const row of (await deps.pool.query('SELECT worker.autopay_candidates($1,$2) AS id', [at, limit])).rows) {
    const prepared = (await deps.pool.query('SELECT worker.prepare_autopay($1,$2) AS v', [row.id, at])).rows[0].v;
    if (!prepared?.id) continue;
    await charge(deps, prepared); charged++;
  }
  return charged;
}

async function finish(deps: AutopayDeps, c: Charge, intent: string | null, amount: number, currency: string, status: string, reason: string | null, retry: boolean) {
  return (await deps.pool.query('SELECT worker.finish_autopay($1,$2,$3,$4,$5,$6,$7) AS v', [c.id, intent, amount, currency, status, reason, retry])).rows[0].v as string;
}

async function charge(deps: AutopayDeps, c: Charge): Promise<string | null> {
  const config: StripeConfig | null = (await deps.pool.query('SELECT worker.stripe_config($1) AS value', [c.credential_id])).rows[0]?.value ?? null;
  if (!config || (deps.production && config.mode !== 'live')) return finish(deps, c, null, 0, 'thb', 'failed', 'PROVIDER_UNAVAILABLE', true);
  const stripe = (deps.client ?? (key => new Stripe(key, { timeout: 20_000, maxNetworkRetries: 1 })))(decrypt(deps.secretKey!, config.secret_sealed));
  let intent: Stripe.PaymentIntent;
  try {
    intent = c.payment_intent ? await stripe.paymentIntents.retrieve(c.payment_intent)
      : await stripe.paymentIntents.create({
        amount: Number(c.amount_minor), currency: 'thb', customer: c.customer_id, payment_method: c.payment_method_id,
        off_session: true, confirm: true, description: c.number,
        metadata: { autopay_charge_id: c.id, invoice_id: c.invoice_id, organization_id: c.organization_id, credential_id: c.credential_id },
      }, { idempotencyKey: `autopay:${c.id}` });
  } catch (e) {
    // Compare the SDK's error type rather than the class, which differs between CJS and ESM copies.
    const error = e as Stripe.errors.StripeError;
    if (error?.type === 'StripeCardError') {
      const code = error.decline_code || error.code || 'card_declined';
      return finish(deps, c, error.payment_intent?.id ?? null, 0, 'thb', 'failed', code, !hardStops.has(code) && !hardStops.has(error.code || ''));
    }
    if (error?.type === 'StripeInvalidRequestError') return finish(deps, c, null, 0, 'thb', 'failed', error.code || 'PROVIDER_ERROR', false);
    // Network or Stripe outage: the charge stays in flight and is resent with the same idempotency key.
    deps.log?.(`AUTOPAY_RETRY ${c.id}`);
    return null;
  }
  if (intent.metadata?.autopay_charge_id !== c.id) return finish(deps, c, null, 0, 'thb', 'failed', 'PAYMENT_MISMATCH', false);
  if (intent.status === 'succeeded') return finish(deps, c, intent.id, intent.amount_received, intent.currency, 'paid', null, false);
  if (intent.status === 'processing') return finish(deps, c, intent.id, 0, intent.currency, 'processing', null, false);
  const code = intent.last_payment_error?.decline_code || intent.last_payment_error?.code || (intent.status === 'requires_action' ? 'authentication_required' : 'card_declined');
  return finish(deps, c, intent.id, 0, intent.currency, 'failed', code, intent.status !== 'requires_action' && !hardStops.has(code));
}
