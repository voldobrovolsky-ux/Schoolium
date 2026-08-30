import {
  IsIn,
  IsOptional,
  IsString,
} from 'class-validator';
import type { GradeSource, GradeValue, SetGradeRequest } from '@edustore/shared';

const GRADE_VALUES: GradeValue[] = ['5', '4', '3', '2', 'н', ''];
const GRADE_SOURCES: GradeSource[] = ['MANUAL', 'VOICE'];

/** Тело POST /journal/grade — выставление/снятие оценки в ячейке. */
export class SetGradeDto implements SetGradeRequest {
  @IsString()
  studentId!: string;

  @IsString()
  lessonId!: string;

  @IsIn(GRADE_VALUES)
  value!: GradeValue;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsIn(GRADE_SOURCES)
  source?: GradeSource;
}

/** Тело PUT /journal/grade/:gradeId — правка значения/комментария. */
export class UpdateGradeDto {
  @IsIn(GRADE_VALUES)
  value!: GradeValue;

  @IsOptional()
  @IsString()
  comment?: string;

  @IsOptional()
  @IsIn(GRADE_SOURCES)
  source?: GradeSource;
}
