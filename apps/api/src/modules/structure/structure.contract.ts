/** Админ-действия структуры, попадающие в аудит ПДн (AR-30): назначения и устройства. */
export const STRUCTURE_EVENTS = {
  assignmentCreated: 'structure.assignment.created.v1',
  assignmentRemoved: 'structure.assignment.removed.v1',
  deviceRemoved: 'structure.device.removed.v1',
} as const;

export interface AssignmentEventV1 {
  assignmentId: string;
  teacherId: string;
  classId?: string;
  subjectId?: string;
}
