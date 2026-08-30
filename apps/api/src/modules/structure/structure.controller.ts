import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { RequirePermission } from '../../common/authz/require-permission.decorator';
import { StructureService } from './structure.service';
import { AddSubGroupDto, AssignDto, CreateClassDto, CreateSubjectDto } from './dto';

// Тенант (школа) берётся из контекста запроса tenant-guard'ом — явная передача org не нужна.
// Мутации гейчены по каталогу §5.1 (AR-35): admin/завуч — классы, методист/завуч — дисциплины.
@Controller('structure')
export class StructureController {
  constructor(private readonly svc: StructureService) {}

  // классы / подгруппы (админ)
  @Get('classes')
  listClasses() {
    return this.svc.listClasses();
  }
  @RequirePermission('structure.classes.manage')
  @Post('classes')
  createClass(@Body() body: CreateClassDto) {
    return this.svc.createClass(body);
  }
  @RequirePermission('structure.classes.manage')
  @Delete('classes/:id')
  deleteClass(@Param('id') id: string) {
    return this.svc.deleteClass(id);
  }
  @RequirePermission('structure.classes.manage')
  @Post('classes/:id/subgroups')
  addSubGroup(@Param('id') id: string, @Body() body: AddSubGroupDto) {
    return this.svc.addSubGroup(id, body);
  }
  @RequirePermission('structure.classes.manage')
  @Delete('subgroups/:id')
  deleteSubGroup(@Param('id') id: string) {
    return this.svc.deleteSubGroup(id);
  }

  // дисциплины (методист/завуч)
  @Get('subjects')
  listSubjects() {
    return this.svc.listSubjects();
  }
  @RequirePermission('structure.disciplines.manage')
  @Post('subjects')
  createSubject(@Body() body: CreateSubjectDto) {
    return this.svc.createSubject(body);
  }
  @RequirePermission('structure.disciplines.manage')
  @Delete('subjects/:id')
  deleteSubject(@Param('id') id: string) {
    return this.svc.deleteSubject(id);
  }

  // распределение учителей (завуч)
  @Get('teachers')
  listTeachers() {
    return this.svc.listTeachers();
  }
  @RequirePermission('structure.distribution.manage')
  @Post('assignments')
  assign(@Body() body: AssignDto) {
    return this.svc.assign(body);
  }
  @RequirePermission('structure.distribution.manage')
  @Delete('assignments/:id')
  unassign(@Param('id') id: string) {
    return this.svc.unassign(id);
  }

  // привязанные устройства (админ → Сеть устройств)
  @Get('devices')
  listDevices() {
    return this.svc.listDevices();
  }
  @RequirePermission('structure.devices.manage')
  @Delete('devices/:id')
  deleteDevice(@Param('id') id: string) {
    return this.svc.deleteDevice(id);
  }
}
