import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { OutboxService } from '../../common/outbox/outbox.service';
import { TenantContext } from '../../common/tenant/tenant-context';
import { newEvent } from '../../common/events/domain-event';
import { STORAGE_PROVIDER, type StorageProvider } from '../../common/storage/storage.types';
import { DOC_EVENTS, type FileCreatedV1 } from './doc.contract';
import { extractText } from './text-extract';

// Статус-FSM (только school-scope). Форк official→draft — не переход, а новый файл (§5, отложено).
const STATUS_NEXT: Record<string, string[]> = {
  draft: ['review'],
  review: ['official', 'draft'],
  official: ['archived'],
  archived: [],
};
const DESCRIPTIVE_DIMS = ['тип', 'предмет', 'класс', 'год', 'тема', 'free']; // scope/audience — НЕ теги (§3)

/**
 * Документохранилище (Документохранилище_ТЗ) — единственный писатель файлов. namespace docs/ —
 * управляемый контур (152-ФЗ). Весь S3 — через StorageProvider (абстракция), AWS-клиент не тут.
 * Летучка-сканы сюда НЕ попадают (их пишет летучка мимо этого модуля).
 */
@Injectable()
export class DocService {
  private readonly log = new Logger('DocService');

  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
    @Inject(STORAGE_PROVIDER) private readonly storage: StorageProvider,
  ) {}

  private key(mime?: string): string {
    const ws = TenantContext.require();
    const ext = mime?.split('/')[1]?.replace(/[^a-z0-9]/gi, '') ?? 'bin';
    return `docs/${ws}/${randomBytes(16).toString('hex')}.${ext}`;
  }

  // ─── Загрузка: upload-url (pre-signed PUT) → commit ───
  async uploadUrl(input: { mime: string; scope?: string; disciplineId?: string; classId?: string }, ownerId: string) {
    const ws = TenantContext.require();
    const s3Key = this.key(input.mime);
    // presign ПЕРВЫМ: если S3 не сконфигурирован (503) — запись не создаём (нет сироты)
    const presigned = await this.storage.getUploadUrl(s3Key, input.mime);
    const file = await this.prisma.file.create({
      data: {
        workspaceId: ws,
        s3Key,
        ownerId,
        mime: input.mime,
        scope: input.scope ?? 'личное',
        disciplineId: input.disciplineId ?? null,
        classId: input.classId ?? null,
        state: 'pending',
      },
    });
    return { fileId: file.id, uploadUrl: presigned.url, expiresIn: presigned.expiresIn };
  }

  /** commit валидирует НАЛИЧИЕ объекта в S3 (HEAD) — нет объекта → 409. state pending→raw. */
  async commit(fileId: string) {
    const ws = TenantContext.require();
    const file = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!file) throw new NotFoundException('файл не найден');
    const head = await this.storage.headObject(file.s3Key); // 503 если S3 не сконфигурирован
    if (!head.exists) {
      throw new ConflictException({ code: 'NO_OBJECT', message: 'объект не загружен в S3 (PUT не выполнен)' });
    }
    const updated = await this.prisma.file.update({
      where: { id: fileId },
      data: { state: 'raw', size: head.size ?? null, mime: head.contentType ?? file.mime },
    });
    await this.prisma.$transaction((tx) =>
      this.outbox.enqueue(tx, newEvent<FileCreatedV1>({ type: DOC_EVENTS.fileCreated, workspaceId: ws, payload: { fileId, s3Key: file.s3Key, scope: file.scope } })),
    );
    return { id: updated.id, state: updated.state, size: updated.size };
  }

  // ─── Чтение ───
  async getFile(id: string) {
    const f = await this.prisma.file.findUnique({ where: { id }, include: { tags: true } });
    if (!f || f.deletedAt) throw new NotFoundException('файл не найден');
    return f;
  }
  async getUrl(id: string) {
    const f = await this.getFile(id);
    const presigned = await this.storage.getDownloadUrl(f.s3Key);
    return { url: presigned.url, expiresIn: presigned.expiresIn };
  }
  list(filters: { scope?: string; audience?: string; disciplineId?: string; classId?: string; q?: string }) {
    const where: Prisma.FileWhereInput = {
      deletedAt: null,
      ...(filters.scope && { scope: filters.scope }),
      ...(filters.audience && { audience: filters.audience }),
      ...(filters.disciplineId && { disciplineId: filters.disciplineId }),
      ...(filters.classId && { classId: filters.classId }),
      ...(filters.q && { OR: [{ textExtract: { contains: filters.q, mode: 'insensitive' } }, { s3Key: { contains: filters.q } }] }),
    };
    return this.prisma.file.findMany({ where, include: { tags: true }, orderBy: { updatedAt: 'desc' } });
  }

  // ─── Теги (только описательные; scope/audience — через setAccess, §3) ───
  async updateTags(fileId: string, add: { dim: string; value: string }[] = [], removeIds: string[] = []) {
    const ws = TenantContext.require();
    for (const t of add) if (!DESCRIPTIVE_DIMS.includes(t.dim)) {
      throw new BadRequestException(`scope/audience задаются через access, не тегом (dim=${t.dim})`);
    }
    if (removeIds.length) await this.prisma.tag.deleteMany({ where: { id: { in: removeIds }, fileId } });
    if (add.length) await this.prisma.tag.createMany({ data: add.map((t) => ({ workspaceId: ws, fileId, dim: t.dim, value: t.value })) });
    return this.prisma.tag.findMany({ where: { fileId } });
  }

  // ─── Доступ (scope/audience — руками владельца/scope-менеджера) ───
  async setAccess(fileId: string, input: { scope?: string; audience?: string }, actor: string) {
    const ws = TenantContext.require();
    const f = await this.prisma.file.update({ where: { id: fileId }, data: { scope: input.scope, audience: input.audience } });
    await this.prisma.$transaction((tx) =>
      this.outbox.enqueue(tx, newEvent({ type: DOC_EVENTS.fileAccessChanged, workspaceId: ws, actor, payload: { fileId, scope: f.scope, audience: f.audience } })),
    );
    return { id: f.id, scope: f.scope, audience: f.audience };
  }

  // ─── Версии ───
  listVersions(fileId: string) {
    return this.prisma.docVersion.findMany({ where: { fileId }, orderBy: { no: 'asc' } });
  }
  async snapshotVersion(fileId: string, authorId: string) {
    const ws = TenantContext.require();
    const f = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!f) throw new NotFoundException('файл не найден');
    const last = await this.prisma.docVersion.findFirst({ where: { fileId }, orderBy: { no: 'desc' } });
    const no = (last?.no ?? 0) + 1;
    const v = await this.prisma.docVersion.create({ data: { workspaceId: ws, fileId, no, s3Key: f.s3Key, authorId } });
    await this.prisma.$transaction((tx) =>
      this.outbox.enqueue(tx, newEvent({ type: DOC_EVENTS.fileVersioned, workspaceId: ws, actor: authorId, payload: { fileId, versionNo: no } })),
    );
    return v;
  }
  async restoreVersion(fileId: string, no: number, authorId: string) {
    const v = await this.prisma.docVersion.findUnique({ where: { fileId_no: { fileId, no } } });
    if (!v) throw new NotFoundException('версия не найдена');
    await this.prisma.file.update({ where: { id: fileId }, data: { s3Key: v.s3Key } });
    return this.snapshotVersion(fileId, authorId); // фиксируем восстановление новой версией
  }

  // ─── Статус-FSM (только school-scope; official иммутабелен — hard-delete запрещён) ───
  async setStatus(fileId: string, to: string, actor: string) {
    const ws = TenantContext.require();
    const f = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!f) throw new NotFoundException('файл не найден');
    if (f.scope !== 'школа') throw new BadRequestException('статус-FSM только для school-scope');
    const from = f.status ?? 'draft';
    if (!(STATUS_NEXT[from] ?? []).includes(to)) {
      throw new ConflictException({ code: 'BAD_TRANSITION', message: `недопустимый переход ${from}→${to}` });
    }
    // форк official→draft (правка official) — новый draft, audience→staff, шары не переносятся (§5) — отложено
    await this.prisma.file.update({ where: { id: fileId }, data: { status: to } });
    await this.prisma.$transaction((tx) =>
      this.outbox.enqueue(tx, newEvent({ type: DOC_EVENTS.fileStatusChanged, workspaceId: ws, actor, payload: { fileId, status: to } })),
    );
    return { id: fileId, status: to };
  }

  // ─── Шары ───
  async share(fileId: string, input: { granteeId?: string; linkToken?: string; level: string; expiresAt?: string }, actor: string) {
    const ws = TenantContext.require();
    const g = await this.prisma.shareGrant.create({
      data: { workspaceId: ws, fileId, granteeId: input.granteeId ?? null, linkToken: input.linkToken ?? null, level: input.level, expiresAt: input.expiresAt ? new Date(input.expiresAt) : null },
    });
    await this.prisma.$transaction((tx) =>
      this.outbox.enqueue(tx, newEvent({ type: DOC_EVENTS.fileShared, workspaceId: ws, actor, payload: { fileId, granteeId: g.granteeId, level: g.level } })),
    );
    return g;
  }
  async revokeShare(shareId: string) {
    await this.prisma.shareGrant.deleteMany({ where: { id: shareId } });
    return { ok: true };
  }

  // ─── Линзы / коллекции ───
  listLenses() {
    return this.prisma.lens.findMany({ orderBy: { name: 'asc' } });
  }
  createLens(input: { name: string; filter: Prisma.InputJsonValue; shared?: boolean }, ownerId: string) {
    return this.prisma.lens.create({
      data: { workspaceId: TenantContext.require(), name: input.name, filter: input.filter, shared: input.shared ?? false, ownerId },
    });
  }
  listCollections() {
    return this.prisma.collection.findMany({ include: { files: true } });
  }
  createCollection(name: string, ownerId: string) {
    return this.prisma.collection.create({ data: { workspaceId: TenantContext.require(), name, ownerId } });
  }

  // ─── Удаление (trash; official school-scope — hard-delete запрещён, только archived) ───
  async deleteFile(id: string, actor: string) {
    const ws = TenantContext.require();
    const f = await this.prisma.file.findUnique({ where: { id } });
    if (!f) throw new NotFoundException('файл не найден');
    if (f.status === 'official') {
      throw new ConflictException({ code: 'OFFICIAL_IMMUTABLE', message: 'официальный файл нельзя удалить (152-ФЗ) — только архивировать' });
    }
    await this.prisma.file.update({ where: { id }, data: { deletedAt: new Date() } }); // trash → purge (GC)
    await this.prisma.$transaction((tx) =>
      this.outbox.enqueue(tx, newEvent({ type: DOC_EVENTS.fileDeleted, workspaceId: ws, actor, payload: { fileId: id, mode: 'trash' } })),
    );
    return { id, deleted: true };
  }

  // ─── Обогащение raw→enriched (вызывается хендлером) ───
  /**
   * Лёгкая экстракция текстового слоя (PDF/text) — здесь, один раз (парсер переиспользует
   * textExtract, повторного разбора файла нет). Тяжёлый пайплайн OCR(Vision)→классификация
   * (DeepSeek)→эмбеддинг — внешний (стаб). Экстракция упала/пусто → state=enriched с
   * textExtract=null (деградация: файл доступен, парсер не запускается).
   */
  async enrich(fileId: string) {
    const ws = TenantContext.require();
    const f = await this.prisma.file.findUnique({ where: { id: fileId } });
    if (!f || f.state !== 'raw') return;
    let textExtract: string | null = null;
    try {
      const body = await this.storage.getObject(f.s3Key);
      if (body) textExtract = await extractText(body, f.mime);
    } catch (e) {
      // не роняем обогащение: без текста файл всё равно enriched (ищется по имени/scope, §9)
      this.log.warn(`enrich ${fileId}: экстракция текста не удалась — ${(e as Error).message}`);
    }
    await this.prisma.file.update({ where: { id: fileId }, data: { state: 'enriched', textExtract } });
    await this.prisma.$transaction((tx) =>
      this.outbox.enqueue(tx, newEvent({ type: DOC_EVENTS.fileEnriched, workspaceId: ws, payload: { fileId, textExtract, tags: [] } })),
    );
  }
}
