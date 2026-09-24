import { describe, expect, it, vi } from 'vitest';
import { DeeSmsxSender, SmsSendError } from './sms';

const config = { baseUrl: 'https://apicall.deesmsx.com', apiKey: 'k', secretKey: 's', sender: 'ServiceFlow' };

function fakeFetch(status: number, body: unknown) {
  return vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
}

describe('DeeSmsxSender', () => {
  it('posts the documented payload with the number as 66xxxxxxxxx', async () => {
    const fetchMock = fakeFetch(200, { error: '0', msg: '[ACCEPTD] Message is in accepted state', status: '200' });
    await new DeeSmsxSender(config, fetchMock).send('+66812345678', 'hello');

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://apicall.deesmsx.com/v1/SMSWebService');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      apiKey: 'k',
      secretKey: 's',
      to: '66812345678',
      sender: 'ServiceFlow',
      msg: 'hello',
    });
  });

  it('accepts a numeric success code', async () => {
    await expect(new DeeSmsxSender(config, fakeFetch(200, { error: 0 })).send('+66812345678', 'x')).resolves.toBeUndefined();
  });

  it.each([
    ['provider error code', 200, { error: '102', msg: 'Your account exceed credit limit.' }, '102'],
    ['http error', 400, { error: '99', msg: 'Invalid telephone format.' }, '99'],
    ['non-JSON body', 502, 'Bad Gateway', undefined],
  ])('throws on %s', async (_, status, body, code) => {
    const err = await new DeeSmsxSender(config, fakeFetch(status, body)).send('+66812345678', 'x').catch((e) => e);
    expect(err).toBeInstanceOf(SmsSendError);
    expect(err.providerCode).toBe(code);
  });

  it('throws when the provider is unreachable', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(new DeeSmsxSender(config, fetchMock).send('+66812345678', 'x')).rejects.toBeInstanceOf(SmsSendError);
  });
});
