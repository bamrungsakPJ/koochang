import { Controller, Get, Module } from '@nestjs/common';
import { Public } from './common/auth/auth-context';
import { CommonModule } from './common/common.module';
import { AuthModule } from './modules/auth/auth.module';
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
  imports: [CommonModule, AuthModule, TeamModule],
  controllers: [HealthController],
})
export class AppModule {}
