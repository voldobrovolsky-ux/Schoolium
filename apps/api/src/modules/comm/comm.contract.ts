/**
 * Communitoria (comm/) — контракты графа контактов и инвариантов безопасности миноров.
 * Несущие принципы: полная аудируемость (нет исчезающих сообщений / секретных чатов), контур comm/
 * изолирован от Документохранилища. События каналов/сообщений/звонков — в следующих чанках; здесь —
 * фундамент безопасности (граф + инварианты), проверяемый e2e ПЕРВЫМ.
 */
export const PARTICIPANT_ROLES = ['teacher', 'parent', 'staff', 'observer', 'external', 'student'] as const;
export type ParticipantRole = (typeof PARTICIPANT_ROLES)[number];

/** Принципал канала/DM: ВЗРОСЛЫЙ (userId=florus_user_id) ЛИБО МИНОР (studentId=Student.id). */
export interface Principal {
  userId?: string;
  studentId?: string;
}

/** Коды инвариантов миноров (бросаются как ForbiddenException — аудируемо). */
export const COMM_ERRORS = {
  /** приватный DM взрослый↔минор без ребра parenthood */
  minorDmRequiresParenthood: 'MINOR_DM_REQUIRES_PARENTHOOD',
  /** приватный DM минор↔минор (безопасный дефолт: миноры — в аудируемых каналах) */
  minorMinorDmForbidden: 'MINOR_MINOR_DM_FORBIDDEN',
  /** канал с участником-минором не принимает участника role=external */
  minorChannelNoExternal: 'MINOR_CHANNEL_NO_EXTERNAL',
  /** mode не задан явно (модель НЕ угадывает режим — human-in-the-loop на входе) */
  modeRequired: 'MODE_REQUIRED',
} as const;

// ─── Каналы / сообщения / объявления (чанк 2) ───
export const CHANNEL_KINDS = ['class', 'subject', 'shmo', 'school', 'parents', 'students', 'external', 'dm'] as const;
export type ChannelKind = (typeof CHANNEL_KINDS)[number];

/** mode ЯВНЫЙ: задаётся отправителем при POST, модель режим не решает. */
export const MESSAGE_MODES = ['chat', 'announcement'] as const;
export type MessageMode = (typeof MESSAGE_MODES)[number];

export const MESSAGE_KINDS = ['text', 'voice', 'sticker', 'call', 'file'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** audience объявления — coarse-селектор, резолвится в required-set userId по scope канала. */
export const ANNOUNCEMENT_AUDIENCES = ['parents', 'staff', 'all'] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

/** FSM подтверждения (→overdue вычисляется по ackDeadline при чтении реестра). */
export const ACK_STATES = ['sent', 'delivered', 'read', 'acknowledged'] as const;
export type AckState = (typeof ACK_STATES)[number];

/** События Communitoria (домен comm.*, канон AR-23 `<домен>.<агрегат>.<глаголПрош>.v<N>`). */
export const COMM_EVENTS = {
  messageSent: 'comm.message.sent.v1',
  announcementPosted: 'comm.announcement.posted.v1',
  ackRecorded: 'comm.ack.recorded.v1',
} as const;

export interface MessageSentV1 {
  messageId: string;
  channelId: string;
  authorId: string;
  mode: MessageMode;
  kind: MessageKind;
}
export interface AnnouncementPostedV1 {
  announcementId: string;
  channelId: string;
  audience: AnnouncementAudience;
  requiredCount: number;
  ackDeadline: string | null;
}
export interface AckRecordedV1 {
  announcementId: string;
  userId: string;
  state: AckState;
}
