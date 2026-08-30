import { IsIn, IsString, MinLength } from 'class-validator';

export class AuthorizeDto {
  // login — вход нового учителя на киоске; kiosk — привязка самого устройства
  @IsIn(['login', 'kiosk'])
  purpose!: 'login' | 'kiosk';
}

export class BindDto {
  @IsString()
  @MinLength(4)
  code!: string;
}
