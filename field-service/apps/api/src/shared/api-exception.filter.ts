import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { normalizeLanguage } from '@field-service/core';
import { errorMessage } from '@field-service/i18n';
@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const request = context.getRequest<{ headers: Record<string, string | undefined>; requestId?: string }>();
    const response = context.getResponse<{ status: (status: number) => { json: (body: unknown) => void }; setHeader: (name: string, value: string) => void }>();
    const status = error instanceof HttpException ? error.getStatus() : 500;
    const payload = error instanceof HttpException ? error.getResponse() : undefined;
    const fields = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    const code = typeof fields.code === 'string' ? fields.code : status < 500 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR';
    if (status >= 500 && !(error instanceof HttpException)) {
      // SQLSTATE and constraint name are safe to log; the message only outside production.
      const db = error as { code?: string; constraint?: string; message?: string };
      console.error('UNHANDLED_ERROR', request.requestId, error instanceof Error ? error.name : typeof error, db.code ?? '', db.constraint ?? '',
        process.env.NODE_ENV === 'production' ? '' : db.message ?? '');
    }
    if (typeof fields.retry_after === 'number') response.setHeader('Retry-After', String(fields.retry_after));
    response.status(status).json({
      code,
      message: errorMessage(normalizeLanguage(request.headers['accept-language']), code),
      ...(fields.field_errors ? { field_errors: fields.field_errors } : {}),
      ...(typeof fields.latest_version === 'number' ? { latest_version: fields.latest_version } : {}),
      ...(typeof fields.retry_after === 'number' ? { retry_after: fields.retry_after } : {}),
      ...(Array.isArray(fields.candidates) ? { candidates: fields.candidates } : {}),
      ...(request.requestId ? { request_id: request.requestId } : {}),
    });
  }
}
