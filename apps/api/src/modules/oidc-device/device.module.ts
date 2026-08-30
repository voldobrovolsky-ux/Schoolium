import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { DeviceController } from './device.controller';
import { DeviceService } from './device.service';

// Привязка устройств и вход на киоске (главная страница, режимы 2/3).
// FlorService — глобальный (AuthModule), отдельно импортировать не нужно.
@Module({
  imports: [PrismaModule],
  controllers: [DeviceController],
  providers: [DeviceService],
})
export class DeviceModule {}
