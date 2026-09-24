import { Module } from '@nestjs/common';
import { MediaModule } from '../media/media.module';
import { JobController } from './job.controller';
import { JobService } from './job.service';

@Module({
  imports: [MediaModule],
  controllers: [JobController],
  providers: [JobService],
})
export class JobModule {}
