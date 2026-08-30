import { Injectable } from '@nestjs/common';
import type { TermDto } from '@edustore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { OutboxService } from '../../common/outbox/outbox.service';
import { newEvent } from '../../common/events/domain-event';
import { SCHOOL_EVENTS, type TermSetV1 } from '../schoolium.contract';
import { SchoolError } from '../schoolium.errors';
import { NON_WORKING_DAYS } from './non-working-days';
import type { SchoolActor } from '../actor';

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);
const parse = (s: string): Date => new Date(`${s}T00:00:00.000Z`);

/**
 * Календарь учебного года — СЕРВИС-ВЛАДЕЛЕЦ периодов, каникул и нерабочих дней
 * (AR-68). Расписание и журнал читают его через контракт и **не хранят
 * собственных дат периодов**: иначе итоговые оценки и сетка разъедутся при
 * первом переносе рабочей субботы.
 */
@Injectable()
export class CalendarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  listTerms(): Promise<{ termNo: number; dateFrom: Date; dateTo: Date }[]> {
    return this.prisma.term.findMany({ orderBy: { termNo: 'asc' } });
  }

  /**
   * §11 строка 17 · `S-41` экран 1. Валидация перечислением: конец после начала
   * (`TERM_REVERSED`), четверти не пересекаются и идут по возрастанию
   * (`TERM_OVERLAP`). В 1.1.1 четвертей ровно четыре — триместры слот (В2).
   */
  async setTerms(terms: TermDto[], actor: SchoolActor) {
    const sorted = [...terms].sort((a, b) => a.termNo - b.termNo);
    for (const t of sorted) {
      if (parse(t.dateTo) <= parse(t.dateFrom)) throw new SchoolError('TERM_REVERSED', { termNo: t.termNo });
    }
    for (let i = 1; i < sorted.length; i += 1) {
      if (parse(sorted[i].dateFrom) <= parse(sorted[i - 1].dateTo)) {
        throw new SchoolError('TERM_OVERLAP', { termNo: sorted[i].termNo });
      }
    }

    const ws = TenantContext.require();
    await this.prisma.$transaction(async (tx) => {
      for (const t of sorted) {
        await tx.term.upsert({
          where: { workspaceId_termNo: { workspaceId: ws, termNo: t.termNo } },
          update: { dateFrom: parse(t.dateFrom), dateTo: parse(t.dateTo) },
          create: { workspaceId: ws, termNo: t.termNo, dateFrom: parse(t.dateFrom), dateTo: parse(t.dateTo) },
        });
        await this.outbox.enqueue(
          tx,
          newEvent<TermSetV1>({
            type: SCHOOL_EVENTS.termSet,
            workspaceId: ws,
            actor: actor.userId,
            payload: { termNo: t.termNo, dateFrom: t.dateFrom, dateTo: t.dateTo },
          }),
        );
      }
    });
    return { ok: true };
  }
}

/**
 * Публичный ЧИТАЮЩИЙ контракт календаря (AR-68). Нерабочие дни — чистая функция
 * справочника: она не ходит в БД и потому одинаково доступна генератору,
 * материализации и воротам.
 */
@Injectable()
export class CalendarContractService {
  constructor(private readonly prisma: PrismaService) {}

  nonWorking(year: number): string[] {
    return NON_WORKING_DAYS[year] ?? [];
  }

  /** Года без данных не бывает молча (AR-100). */
  assertYear(year: number): void {
    if (!NON_WORKING_DAYS[year]) throw new SchoolError('CALENDAR_YEAR_MISSING', { year });
  }

  isSchoolDay(d: Date): boolean {
    const dow = d.getUTCDay();
    if (dow === 0 || dow === 6) return false;
    return !this.nonWorking(d.getUTCFullYear()).includes(isoDay(d));
  }

  terms(): Promise<{ termNo: number; dateFrom: Date; dateTo: Date }[]> {
    return this.prisma.term.findMany({ orderBy: { termNo: 'asc' } });
  }

  /**
   * Ближайший учебный день из календаря — им журнал отвечает в каникулы
   * («Каникулы. Ближайший учебный день — 9 января»). Пустое состояние, которое
   * зовёт настроить уже настроенное, отправляет модератора чинить исправное.
   */
  async nextSchoolDay(from: Date): Promise<string | null> {
    const terms = await this.terms();
    if (!terms.length) return null;
    const cursor = new Date(from);
    for (let i = 0; i < 400; i += 1) {
      const inTerm = terms.some((t) => cursor >= t.dateFrom && cursor <= t.dateTo);
      if (inTerm && this.isSchoolDay(cursor)) return isoDay(cursor);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return null;
  }

  /** Идут ли сейчас каникулы: дата вне всех четвертей, но год учебный. */
  async onHolidays(day: Date): Promise<boolean> {
    const terms = await this.terms();
    if (!terms.length) return false;
    return !terms.some((t) => day >= t.dateFrom && day <= t.dateTo);
  }
}
