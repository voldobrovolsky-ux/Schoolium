import { IsInt, IsOptional, IsString, Max, Min, MaxLength } from 'class-validator';

export class CreateClassDto {
  @IsInt() @Min(1) @Max(11) parallel!: number;
  @IsString() @MaxLength(8) letter!: string;
}

export class AddSubGroupDto {
  @IsString() @MaxLength(40) name!: string;
}

export class CreateSubjectDto {
  @IsString() @MaxLength(80) name!: string;
  @IsOptional() @IsString() color?: string;
}

export class AssignDto {
  @IsString() teacherId!: string;
  @IsString() classId!: string;
  @IsString() subjectId!: string;
  @IsOptional() @IsString() subGroupId?: string;
}
