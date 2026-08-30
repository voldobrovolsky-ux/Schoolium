import { Module } from '@nestjs/common';
import { NutritionHandlers } from './nutrition.handlers';

@Module({ providers: [NutritionHandlers] })
export class NutritionModule {}
