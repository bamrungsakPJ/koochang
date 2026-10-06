import test from 'node:test';
import assert from 'node:assert/strict';
import { ClaudeOcrProvider, TemporaryOcrError, createOcrProvider } from '../apps/api/dist/ocr/ocr.provider.js';

// Mocked client only: these tests never call the real Claude API. The SDK is loaded through its ESM
// entry, the same copy the API imports, so its error classes match.
const { default: Anthropic } = await import(new URL('../apps/api/node_modules/@anthropic-ai/sdk/index.mjs', import.meta.url).href);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
function client(reply) { const calls = []; return { calls, beta: { messages: { create: async params => { calls.push(params); return typeof reply === 'function' ? reply() : reply; } } } }; }
const answer = (data, stop_reason = 'end_turn') => ({ stop_reason, content: [{ type: 'text', text: JSON.stringify(data) }] });

test('Claude OCR sends the image with a JSON schema and returns cleaned suggestions', async () => {
  const c = client(answer({ brand: ' Daikin ', model: 'FTKC18TV2S', serial_number: 'E012345', raw_text: 'DAIKIN\nFTKC18TV2S', confidence: 1.4 }));
  const result = await new ClaudeOcrProvider(c, 'claude-haiku-4-5-20251001').read(jpeg);
  assert.deepEqual(result, { fields: { brand: 'Daikin', model: 'FTKC18TV2S', serial_number: 'E012345' } });
  const p = c.calls[0];
  assert.equal(p.model, 'claude-haiku-4-5-20251001');
  assert.equal(p.max_tokens, 512);
  assert.equal(p.thinking.type, 'disabled');
  assert.equal(p.output_config.effort, undefined);
  assert.equal(p.fallbacks, undefined);
  assert.equal(p.betas, undefined);
  assert.equal(p.output_config.format.schema.properties.raw_text, undefined);
  assert.equal(p.output_config.format.type, 'json_schema');
  assert.deepEqual(p.output_config.format.schema.required, ['brand', 'model', 'serial_number']);
  assert.equal(p.messages[0].content.length, 1);
  assert.equal(typeof p.system, 'string');
  assert.equal(p.messages[0].content[0].source.media_type, 'image/jpeg');
  assert.equal(p.messages[0].content[0].source.data, jpeg.toString('base64'));
  await new ClaudeOcrProvider(c, 'claude-haiku-4-5-20251001').read(png);
  assert.equal(c.calls[1].messages[0].content[0].source.media_type, 'image/png');
});

test('Claude OCR leaves unreadable fields out instead of inventing them', async () => {
  const result = await new ClaudeOcrProvider(client(answer({ brand: 'Mitsubishi', model: '', serial_number: '', raw_text: 'MITSUBISHI', confidence: 0.3 })), 'm').read(jpeg);
  assert.deepEqual(result.fields, { brand: 'Mitsubishi' });
});

test('Claude OCR: temporary API problems are retried, everything else fails the job', async () => {
  const conn = new ClaudeOcrProvider(client(() => { throw new Anthropic.APIConnectionError({ message: 'offline' }); }), 'm');
  await assert.rejects(conn.read(jpeg), e => e instanceof TemporaryOcrError);
  const limited = new ClaudeOcrProvider(client(() => { throw Anthropic.APIError.generate(429, { error: { type: 'rate_limit_error' } }, 'slow down', new Headers()); }), 'm');
  await assert.rejects(limited.read(jpeg), e => e instanceof TemporaryOcrError && e.message === 'CLAUDE_429');
  const overloaded = new ClaudeOcrProvider(client(() => { throw Anthropic.APIError.generate(529, { error: { type: 'overloaded_error' } }, 'busy', new Headers()); }), 'm');
  await assert.rejects(overloaded.read(jpeg), e => e instanceof TemporaryOcrError);
  const bad = new ClaudeOcrProvider(client(() => { throw Anthropic.APIError.generate(400, { error: { type: 'invalid_request_error' } }, 'bad image', new Headers()); }), 'm');
  await assert.rejects(bad.read(jpeg), e => !(e instanceof TemporaryOcrError) && e.message === 'CLAUDE_400');
  await assert.rejects(new ClaudeOcrProvider(client({ stop_reason: 'refusal', content: [] }), 'm').read(jpeg), e => !(e instanceof TemporaryOcrError) && e.message === 'CLAUDE_REFUSED');
  await assert.rejects(new ClaudeOcrProvider(client({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] }), 'm').read(jpeg), /CLAUDE_INVALID_OUTPUT/);
  await assert.rejects(new ClaudeOcrProvider(client(answer({})), 'm').read(Buffer.alloc(0)), /EMPTY_IMAGE/);
});

test('OCR_PROVIDER=claude needs a server-side key and otherwise stays closed', () => {
  assert.equal(createOcrProvider({ NODE_ENV: 'production', OCR_PROVIDER: 'claude' }), null);
  const p = createOcrProvider({ NODE_ENV: 'production', OCR_PROVIDER: 'claude', ANTHROPIC_API_KEY: 'test-only' });
  assert.equal(p?.name, 'claude');
  assert.equal(createOcrProvider({ NODE_ENV: 'production' }), null);
});
