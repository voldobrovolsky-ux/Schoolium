import { Module } from '@nestjs/common';
import { ComplianceHandlers } from './compliance.handlers';

// Подписчик комплаенса на события удаления ПДн (§6.4). EventBus/Inbox — глобальные.
@Module({
  providers: [ComplianceHandlers],
})
export class ComplianceModule {}
