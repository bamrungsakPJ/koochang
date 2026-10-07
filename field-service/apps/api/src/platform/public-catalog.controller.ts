import { Controller, Get, Res } from '@nestjs/common';
import { PlatformDatabaseService } from './platform-database.service.js';

@Controller('catalog')
export class PublicCatalogController {
  constructor(private readonly database: PlatformDatabaseService) {}
  @Get()
  async catalog(@Res({ passthrough: true }) response: { setHeader(name: string, value: string): void }) {
    const catalog = await this.database.run(async c => (await c.query('SELECT padmin.public_catalog() AS v')).rows[0].v);
    response.setHeader('Cache-Control', 'public, max-age=60');
    return catalog;
  }
}
