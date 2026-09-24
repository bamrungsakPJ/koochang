import { Module } from '@nestjs/common';
import { CustomerModule } from '../customer/customer.module';
import { MediaModule } from '../media/media.module';
import { AssetController } from './asset.controller';
import { AssetService } from './asset.service';

@Module({
  imports: [CustomerModule, MediaModule],
  controllers: [AssetController],
  providers: [AssetService],
  exports: [AssetService],
})
export class AssetModule {}
