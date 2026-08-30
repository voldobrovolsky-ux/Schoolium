import { Module } from '@nestjs/common';
import { UmkHandlers } from './umk.handlers';

@Module({ providers: [UmkHandlers] })
export class UmkParamModule {}
