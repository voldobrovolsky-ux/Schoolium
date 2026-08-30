import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  // Все контроллеры — под префиксом /api (маршруты задаются без него).
  app.setGlobalPrefix('api');

  // CORS для фронта (Vite dev-сервер).
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    credentials: true,
  });

  // Валидация и трансформация DTO во всех эндпоинтах.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  // Голосовое аудио base64 может быть объёмным — поднимаем лимит тела запроса.
  const express = require('express');
  app.use(express.json({ limit: '25mb' }));
  app.use(express.urlencoded({ limit: '25mb', extended: true }));

  // Cookie (httpOnly-сессия Флёруса flor_sid, транзакция flor_tx).
  const cookieParser = require('cookie-parser');
  app.use(cookieParser());

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`EduStore API готова: http://localhost:${port}/api`);
}

void bootstrap();
