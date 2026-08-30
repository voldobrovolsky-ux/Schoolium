import type { DomainEvent } from './domain-event';

export type EventHandler = (event: DomainEvent) => Promise<void>;

export interface Subscription {
  pattern: string;
  consumer: string;
  handler: EventHandler;
}

/**
 * Абстракция шины. Dev/тест — in-process; прод — NATS JetStream (тот же интерфейс).
 * Параметры публикуют через outbox и подписываются здесь.
 */
export abstract class EventBus {
  abstract publish(event: DomainEvent): Promise<void>;
  abstract subscribe(
    pattern: string,
    consumer: string,
    handler: EventHandler,
  ): void;
}

/** NATS-style сопоставление subject: '*' = один сегмент, '>' = хвост. */
export function subjectMatches(pattern: string, subject: string): boolean {
  const p = pattern.split('.');
  const s = subject.split('.');
  for (let i = 0; i < p.length; i++) {
    if (p[i] === '>') return true;
    if (i >= s.length) return false;
    if (p[i] !== '*' && p[i] !== s[i]) return false;
  }
  return p.length === s.length;
}
