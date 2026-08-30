import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { COMM_ERRORS, type Principal } from './comm.contract';

/**
 * Граф контактов Communitoria — СТРУКТУРНЫЙ, read-only: выводится из RBAC (членства) + рёбер
 * `parenthood`. Никакого «поиска и DM кому угодно». Здесь же — инварианты безопасности миноров.
 *
 * Ключевой принцип: разрешение приватного контакта взрослый↔минор проверяется по НАЛИЧИЮ ребра
 * parenthood (взрослый ↔ ЭТОТ ребёнок), НЕ по роли 'parent' и НЕ по «строжайшей» роли двойного лица.
 * Учитель-он-же-родитель к СВОЕМУ ребёнку — по ребру; к чужому минору — запрещено (роль учителя не
 * даёт послаблений).
 */
@Injectable()
export class GraphService {
  constructor(private readonly prisma: PrismaService) {}

  /** Минор ⟺ принципал — Student. В схеме нет возраста → «несовершеннолетний» = ученик (роль). */
  isMinor(p: Principal): boolean {
    return !!p.studentId;
  }

  /** Ребро родительства (взрослый ↔ КОНКРЕТНЫЙ ребёнок) есть? Проверка по ребру, не по роли. */
  async isParentOf(parentUserId: string, studentId: string): Promise<boolean> {
    const edge = await this.prisma.parenthood.findUnique({
      where: { parentUserId_studentId: { parentUserId, studentId } },
    });
    return edge !== null;
  }

  /**
   * Инвариант приватного DM (1:1):
   *  - взрослый↔взрослый — разрешено (структурно, один workspace);
   *  - взрослый↔минор — ТОЛЬКО при ребре parenthood между ними (наблюдателя в 1:1 нет — он для
   *    многосторонних каналов/звонков);
   *  - минор↔минор — запрещено (безопасный дефолт: миноры общаются в аудируемых каналах).
   * Бросает ForbiddenException с кодом инварианта (аудируемо). Порядок принципалов не важен.
   */
  async assertPrivateDmAllowed(a: Principal, b: Principal): Promise<void> {
    const aMinor = this.isMinor(a);
    const bMinor = this.isMinor(b);
    if (!aMinor && !bMinor) return; // взрослый↔взрослый
    if (aMinor && bMinor) {
      throw new ForbiddenException({ code: COMM_ERRORS.minorMinorDmForbidden, message: 'приватный DM минор↔минор запрещён' });
    }
    const adultUserId = (aMinor ? b.userId : a.userId) as string;
    const minorStudentId = (aMinor ? a.studentId : b.studentId) as string;
    if (!(await this.isParentOf(adultUserId, minorStudentId))) {
      throw new ForbiddenException({
        code: COMM_ERRORS.minorDmRequiresParenthood,
        message: 'приватный DM взрослый↔минор разрешён только родителю ЭТОГО ребёнка (по ребру parenthood)',
      });
    }
  }

  /** Контакты взрослого (структурно): его дети по рёбрам parenthood. */
  async contactsForAdult(userId: string) {
    const edges = await this.prisma.parenthood.findMany({ where: { parentUserId: userId } });
    return { userId, children: edges.map((e) => e.studentId) };
  }

  /** Контакты минора (структурно): его родители по рёбрам parenthood. */
  async contactsForMinor(studentId: string) {
    const edges = await this.prisma.parenthood.findMany({ where: { studentId } });
    return { studentId, parents: edges.map((e) => e.parentUserId) };
  }
}
