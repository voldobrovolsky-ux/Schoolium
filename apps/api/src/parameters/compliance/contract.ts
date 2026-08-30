/** События комплаенса 152-ФЗ (§6.4). Кросс-продуктовый конверт отложен (D9) — типы внутри EduStore. */
export const COMPLIANCE_EVENTS = {
  consentRecorded: 'compliance.consent.recorded.v1',
  deletionRequested: 'compliance.deletion.requested.v1',
  deletionCompleted: 'compliance.deletion.completed.v1',
} as const;

export interface ConsentRecordedV1 {
  subjectUserId: string;
  purpose: string;
  granted: boolean;
  source: string;
}

export interface DeletionRequestedV1 {
  subjectUserId: string;
  requestedBy: string;
  reason?: string;
}

export interface DeletionCompletedV1 {
  subjectUserId: string;
  anonymized: boolean; // обязательная отчётность обезличивается, не удаляется
}
