/** Контракты завуча/методиста (Архстандарт §6). Категории standards.updated не пересекаются. */
export const STANDARDS_EVENTS = {
  assessmentPolicyUpdated: 'standards.assessment_policy.updated.v1',
  timingProfileUpdated: 'standards.timing_profile.updated.v1',
  standardsUpdated: 'standards.org.updated.v1', // category: оргстандарты | содержание | шаблон
  fgosHoursApproved: 'standards.fgos_hours.approved.v1',
} as const;

export interface StandardsUpdatedV1 {
  category: string;
}
export interface FgosHoursApprovedV1 {
  classId: string;
  disciplineId: string;
  hours: number;
}
