// Контракты событий Контингентного параметра (публичный API для других параметров).
export const CONTINGENT_EVENTS = {
  studentEnrolled: 'contingent.student.enrolled.v1',
} as const;

export interface StudentEnrolledV1 {
  studentId: string;
  classId: string;
  displayName: string;
  number: number;
}
