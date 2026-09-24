import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/**
 * In-memory sliding-window limiter. Fine while the API is a single process;
 * move to the database (or Redis) if the API is ever scaled out.
 */
@Injectable()
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  consume(key: string, limit: number, windowMs: number): boolean {
    const now = Date.now();
    if (this.hits.size > 50_000) this.sweep(now, windowMs);
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  enforce(key: string, limit: number, windowMs: number): void {
    if (!this.consume(key, limit, windowMs)) {
      throw new HttpException('ทำรายการบ่อยเกินไป กรุณารอสักครู่', HttpStatus.TOO_MANY_REQUESTS);
    }
  }

  reset(): void {
    this.hits.clear();
  }

  private sweep(now: number, windowMs: number) {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= windowMs)) this.hits.delete(key);
    }
  }
}

/** Cloudflare Tunnel puts the real client IP in CF-Connecting-IP. */
export function clientIp(req: Request): string {
  const cf = req.headers['cf-connecting-ip'];
  if (typeof cf === 'string' && req.app.get('trust proxy')) return cf;
  return req.ip ?? 'unknown';
}
