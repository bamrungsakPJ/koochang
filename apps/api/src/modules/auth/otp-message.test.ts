import { describe, expect, it } from 'vitest';
import { otpMessage } from './otp.service';

describe('otpMessage', () => {
  it('fits in one Thai SMS credit (70 characters)', () => {
    expect(otpMessage('123456').length).toBeLessThanOrEqual(70);
  });
});
