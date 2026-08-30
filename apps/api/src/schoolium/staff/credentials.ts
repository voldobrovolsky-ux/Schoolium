import { randomInt, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { ACCESS_PARAMS, usernameFromFio, usernameProblem, type CredentialsDto } from '@edustore/shared';
import type { PrismaClient } from '@prisma/client';
import { SchoolError } from '../schoolium.errors';

/**
 * Креды учётки 1.2.0 (AR-154, AR-156). Учётку целиком заводит модератор;
 * пароль — резервный вход, генерируется здесь и показывается модератору на
 * карточке открытым текстом один раз (перевыпуск — новой генерацией).
 *
 * bcrypt cost 12 — байт-в-байт совместимо с bcryptjs Флёруса: при миграции
 * (AR-157) хэш переносится, пароль не спрашивается заново.
 */
const BCRYPT_COST = 12;

/** Алфавит без неоднозначных знаков (0/O, 1/l/I): пароль диктуется вслух. */
const PW_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function generatePassword(length = 10): string {
  return Array.from({ length }, () => PW_ALPHABET[randomInt(PW_ALPHABET.length)]).join('');
}

export function hashPassword(plain: string): string {
  if (plain.length < ACCESS_PARAMS.passwordMinLength) throw new SchoolError('PASSWORD_TOO_SHORT');
  return bcrypt.hashSync(plain, BCRYPT_COST);
}

export function verifyPassword(plain: string, hash: string | null): boolean {
  // сравнение с фиктивным хэшем выравнивает время ответа: отказ не выдаёт,
  // существует ли юзернейм (правило LOGIN_FAILED, AR-156)
  return bcrypt.compareSync(plain, hash ?? DUMMY_HASH) && hash !== null;
}
const DUMMY_HASH = bcrypt.hashSync('schoolium-no-such-user', BCRYPT_COST);

type Tx = Pick<PrismaClient, 'user'>;

/**
 * Юзернейм: заданный модератором проверяется по правилам Флёруса; пустой —
 * предзаполняется транслитерацией ФИО, занятость решается числовым суффиксом.
 * Занятый ЗАДАННЫЙ юзернейм — отказ `USERNAME_TAKEN` модератору, не суффикс:
 * имя выбирал человек, молча изменять его выбор нельзя.
 */
export interface CreateAccountArgs {
  workspaceId: string;
  lastName: string;
  firstName: string;
  middleName?: string | null;
  username?: string | null;
  password?: string | null;
  roles: string[];
}

/**
 * Учётка целиком за один вызов (AR-154): `User` (юзернейм + хэш) + `Membership`
 * (роли, `activatedAt: null` — вход появится сканом). Единая точка для
 * персонала, учеников и родителей — три вида карточек не расходятся правилами.
 * Вызывать под `TenantContext.runAsSystem`.
 */
export async function createAccountWithMembership(
  prisma: PrismaClient,
  args: CreateAccountArgs,
): Promise<{ userId: string; credentials: CredentialsDto }> {
  const username = await resolveUsername(prisma, args.username, {
    lastName: args.lastName.trim(),
    firstName: args.firstName.trim(),
  });
  const password = args.password?.trim() || generatePassword();
  const passwordHash = hashPassword(password);
  const userId = `u-${randomUUID()}`;
  const displayName = `${args.lastName.trim()} ${args.firstName.trim()}`.trim();
  await prisma.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        id: userId,
        firstName: args.firstName.trim(),
        lastName: args.lastName.trim(),
        middleName: args.middleName?.trim() || null,
        displayName,
        username,
        passwordHash,
      },
    });
    await tx.membership.create({
      data: {
        florusUserId: userId, // legacy-колонка контура КТП (AR-58)
        userId,
        workspaceId: args.workspaceId,
        florusRole: 'staff',
        roles: args.roles,
      },
    });
  });
  return { userId, credentials: { username, password } };
}

export async function resolveUsername(
  tx: Tx,
  given: string | null | undefined,
  fio: { lastName: string; firstName: string },
): Promise<string> {
  if (given?.trim()) {
    const u = given.trim().toLowerCase();
    if (usernameProblem(u)) throw new SchoolError('USERNAME_INVALID', { username: u });
    if (await tx.user.findUnique({ where: { username: u } })) throw new SchoolError('USERNAME_TAKEN', { username: u });
    return u;
  }
  const base = usernameFromFio(fio.lastName, fio.firstName);
  let candidate = usernameProblem(base) ? `user_${base}`.slice(0, 30) : base;
  for (let i = 0; ; i += 1) {
    const u = i === 0 ? candidate : `${candidate.slice(0, 30 - String(i).length)}${i}`;
    if (!usernameProblem(u) && !(await tx.user.findUnique({ where: { username: u } }))) return u;
    if (i > 500) throw new SchoolError('USERNAME_TAKEN', { username: base });
  }
}
