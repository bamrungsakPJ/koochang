import { Controller, Get, Module } from '@nestjs/common';
import { Public } from './common/auth/auth-context';
import { CommonModule } from './common/common.module';
import { AssetModule } from './modules/asset/asset.module';
import { AuthModule } from './modules/auth/auth.module';
import { CustomerModule } from './modules/customer/customer.module';
import { JobModule } from './modules/job/job.module';
import { MediaModule } from './modules/media/media.module';
import { TeamModule } from './modules/team/team.module';

@Controller('health')
class HealthController {
  @Public()
  @Get()
  health() {
    return { ok: true };
  }
}

@Module({
  imports: [CommonModule, AuthModule, TeamModule, MediaModule, CustomerModule, AssetModule, JobModule],
  controllers: [HealthController],
})
export class AppModule {}
