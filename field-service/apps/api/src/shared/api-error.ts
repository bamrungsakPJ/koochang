import { HttpException } from '@nestjs/common';
import type { ErrorCode, FieldErrors } from '@field-service/core';

export interface ApiErrorBody {
  code: ErrorCode;
  field_errors?: FieldErrors;
  latest_version?: number;
  retry_after?: number;
  candidates?: unknown[];
}

/** Throwable API error. The filter adds the translated message and request_id. */
export function apiError(status: number, code: ErrorCode, extra: Omit<ApiErrorBody, 'code'> = {}): HttpException {
  return new HttpException({ code, ...extra }, status);
}

/** Collects field errors; field values are translation keys (field.required, field.phone...). */
export class Validation {
  readonly errors: FieldErrors = {};
  text(field: string, value: unknown, { required = true, max = 120 } = {}): string | undefined {
    const text = typeof value === 'string' ? value.trim() : '';
    if (!text) { if (required) this.errors[field] = 'field.required'; return undefined; }
    if (text.length > max) { this.errors[field] = 'field.tooLong'; return undefined; }
    return text;
  }
  fail(field: string, key: string) { this.errors[field] = key; }
  done() { if (Object.keys(this.errors).length) throw apiError(400, 'VALIDATION_ERROR', { field_errors: this.errors }); }
}

export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
