// Свойства спеки 1.1.1: генератор, материализация, журнал, контингент.
// Одноразовая модель (T2): без БД, без сети. Задача — сломать спеку.
import { states, transitions } from './states.mjs';
let fails = 0, notes = [];
const ok  = (m)=>console.log('  ✅ '+m);
const bad = (m)=>{ console.error('  ❌ '+m); fails++; };
const note= (m)=>{ notes.push(m); };

// ---------- P1. Мастер: литеры, пол, превью ----------
console.log('P1. Мастер классов');
const preview = (par, letters)=> letters ? par*letters.length : par;
if (preview(8,null)===8) ok('8 параллелей «без литер» → 8 классов'); else bad('превью без литер');
if (preview(8,['А','Б','В','Г'])===32) ok('8 × А-Г → превью показывает 32 класса до подтверждения (Д5)'); else bad('превью литер');
const derive = (total,boys)=> boys>total ? null : {boys, girls: total-boys};
if (derive(15,9).girls===6) ok('пол: 15 всего, 9 мальчиков → 6 девочек вычислено'); else bad('вычисление пола');
if (derive(15,16)===null) ok('мальчиков больше численности → отказ, не отрицательные девочки'); else bad('валидация пола');

// ---------- P2. Алфавит: ё, отсутствие отчества ----------
console.log('P2. Контингент: сортировка и деактивация');
const norm = s=> (s||'').toLowerCase().replace(/ё/g,'е');
const cmp = (a,b)=> norm(a.last).localeCompare(norm(b.last),'ru') || norm(a.first).localeCompare(norm(b.first),'ru') || norm(a.mid).localeCompare(norm(b.mid),'ru');
const kids = [
  {last:'Ёлкина',first:'Анна',mid:''},{last:'Егоров',first:'Пётр',mid:'Ильич'},
  {last:'Елагин',first:'Иван',mid:''},{last:'Абалкин',first:'Юрий',mid:'Олегович'},
].sort(cmp);
if (kids[0].last==='Абалкин' && kids.map(k=>k.last).indexOf('Ёлкина')===3 && kids[1].last==='Егоров')
  ok('алфавит: Ё=Е при сортировке, отчество опционально не ломает порядок');
else bad('сортировка: '+kids.map(k=>k.last).join(','));

// ---------- P3. Группы: дефолт-разбиение и покрытие ----------
console.log('P3. Группы (AR-75)');
const split = (students, g)=> students.map((s,i)=>({ ...s, group: 1 + Math.floor(i*g/students.length) }));
const cls = split(Array.from({length:15},(_,i)=>({id:i})), 2);
const g1 = cls.filter(s=>s.group===1).length, g2 = cls.filter(s=>s.group===2).length;
if (g1+g2===15 && Math.abs(g1-g2)<=1) ok(`дефолт-разбиение 15 на 2 группы: ${g1}+${g2}, каждый ровно в одной`); else bad('разбиение групп');

// ---------- P4. Валидация нагрузки ----------
console.log('P4. Нагрузка и отказы до перебора');
const SANPIN = {1:21,2:23,3:23,4:23,5:29,6:30,7:32,8:33,9:33,10:34,11:34}; // 5-дневка, табл. 6.6
function validateLoad(cls){
  const total = cls.pairs.reduce((a,p)=>a+ (p.scope==='class'? p.hours : 0),0)
              + Math.max(0,...[1,2].map(g=>cls.pairs.filter(p=>p.scope==='group'&&p.groups.includes(g)).reduce((a,p)=>a+p.hours,0)), 0);
  if (total > SANPIN[cls.parallel]) return {code:'LOAD_EXCEEDS_SANPIN', total, cap:SANPIN[cls.parallel]};
  if (total > cls.days*cls.slots) return {code:'LOAD_EXCEEDS_GRID', total, grid:cls.days*cls.slots};
  // групповые часы одного предмета: равны ли по группам?
  for (const subj of new Set(cls.pairs.filter(p=>p.scope==='group').map(p=>p.subject))) {
    const hs = [1,2].map(g=>cls.pairs.filter(p=>p.subject===subj&&p.groups.includes(g)).reduce((a,p)=>a+p.hours,0));
    if (hs[0]!==hs[1]) return {code:'GROUP_HOURS_UNEQUAL', subject:subj, hours:hs};
  }
  return null;
}
const c5 = {parallel:5, days:5, slots:7, pairs:[
  {subject:'математика',scope:'class',hours:5},{subject:'русский',scope:'class',hours:5},
  {subject:'литература',scope:'class',hours:3},{subject:'история',scope:'class',hours:2},
  {subject:'биология',scope:'class',hours:2},{subject:'физкультура',scope:'class',hours:3},
  {subject:'англ',scope:'group',groups:[1],hours:3},{subject:'англ',scope:'group',groups:[2],hours:3},
]};
if (validateLoad(c5)===null) ok('нагрузка 5 класса (23 ч, англ по группам 3+3) проходит'); else bad('ложный отказ на валидной нагрузке');
const over = {...c5, pairs:[...c5.pairs, {subject:'доп',scope:'class',hours:10}]};
const r1 = validateLoad(over);
if (r1?.code==='LOAD_EXCEEDS_SANPIN') ok(`перегруз → ${r1.code} (${r1.total} > ${r1.cap}) — именованный отказ до перебора`); else bad('перегруз не пойман: '+JSON.stringify(r1));
const uneq = {...c5, pairs: c5.pairs.map(p=> p.scope==='group'&&p.groups.includes(2) ? {...p,hours:1} : p)};
const r2 = validateLoad(uneq);
if (r2?.code==='GROUP_HOURS_UNEQUAL') { ok(`англ: группа 1 — 3 ч, группа 2 — 1 ч → ${r2.code}`); note('НАХОДКА: спека (экран 2) не содержала валидации «часы групп одного предмета равны» — два педагога могут вписать разные часы, и полуокно станет неустранимым. Валидация добавлена в спеку.'); }
else bad('неравные часы групп не пойманы');

// ---------- P5. Генератор: перебор с проверкой ограничений ----------
console.log('P5. Генератор (шаблон недели)');
function generate(classes, teachers, days, slots, seed){
  // Единицы планирования: класс-час (1 педагог) и СПАРЕННЫЙ групповой час
  // (обе группы предмета в одном слоте, 2 педагога) — правило пар из AR-75.
  const units=[];
  for (const c of classes){
    const groupSubjects = new Map();
    for (const p of c.pairs){
      if (p.scope==='class'){ for(let h=0;h<p.hours;h++) units.push({cls:c.id, teachers:[p.teacher], kind:'class'}); }
      else { const k=p.subject; (groupSubjects.get(k)||groupSubjects.set(k,[]).get(k)).push(p); }
    }
    for (const [subj, ps] of groupSubjects){
      const hrs = ps[0].hours;
      if (ps.length!==2 || ps.some(p=>p.hours!==hrs)) return {code:'GROUP_HOURS_UNEQUAL', subject:subj, cls:c.id};
      for(let h=0;h<hrs;h++) units.push({cls:c.id, teachers:ps.map(p=>p.teacher), kind:'paired'});
    }
  }
  // арифметические отказы ДО перебора
  const tHours={};
  for(const u of units) for(const t of u.teachers) tHours[t]=(tHours[t]||0)+1;
  for(const [t,h] of Object.entries(tHours)) if(h>days*slots) return {code:'TEACHER_OVERBOOKED', teacher:t, hours:h, cap:days*slots};
  let rng = seed;
  const rand = ()=> (rng = (rng*1103515245+12345)&0x7fffffff)/0x7fffffff;
  const order = units.map((u,i)=>[rand(),i]).sort((a,b)=>a[0]-b[0]).map(([,i])=>units[i]);
  const busyT={}, dayLen={}, grid={};
  function tryPlace(u){
    const opts=[];
    for(let d=0;d<days;d++){
      const s = dayLen[u.cls+':'+d]||0;              // без окон: следующий подряд слот
      if (s>=slots) continue;
      if (u.teachers.some(t=>busyT[d+':'+s+':'+t])) continue;
      opts.push([d,s]);
    }
    if(!opts.length) return false;
    const [d,s]=opts[Math.floor(rand()*opts.length)];
    for(const t of u.teachers) busyT[d+':'+s+':'+t]=true;
    (grid[d+':'+s]=grid[d+':'+s]||[]).push(u);
    dayLen[u.cls+':'+d]=s+1;
    return true;
  }
  for (const u of order) if(!tryPlace(u)) return {code:'NO_SOLUTION', unit:u};
  return {grid};
}
function verify(res, classes, days, slots){
  const v=[]; const grid=res.grid;
  for(let d=0;d<days;d++) for(const c of classes){
    const daySlots=[];
    for(let s=0;s<slots;s++) daySlots.push((grid[d+':'+s]||[]).filter(u=>u.cls===c.id));
    const lastBusy = daySlots.reduce((m,cell,i)=>cell.length?i:m,-1);
    daySlots.forEach((cell,s)=>{
      if(s<lastBusy && cell.length===0) v.push(`окно: класс ${c.id}, день ${d+1}, урок ${s+1}`);
      if(cell.length>1) v.push(`двойная занятость класса ${c.id}: день ${d+1}, урок ${s+1}`);
      if(cell.length===1 && cell[0].kind==='paired' && cell[0].teachers.length!==2)
        v.push(`групповой час без пары: класс ${c.id}, день ${d+1}, урок ${s+1}`);
    });
  }
  // педагог в двух местах
  const seenT={};
  for(const [k,cell] of Object.entries(grid)) for(const u of cell) for(const t of u.teachers){
    const kk=k+':'+t; if(seenT[kk]) v.push(`педагог ${t} в двух местах: слот ${k}`); seenT[kk]=true;
  }
  return v;
}
const teachers=['Мария','Ольга','Иван','Пётр','Анна','Нина','Олег','Юлия','Егор','Вера'];
const classes = Array.from({length:8},(_,i)=>({id:i+1, parallel:i+1, days:5, slots:7, pairs:[
  {subject:'математика',scope:'class',hours:4,teacher:teachers[i%3]},
  {subject:'русский',scope:'class',hours:4,teacher:teachers[3+i%3]},
  {subject:'окружающий/история',scope:'class',hours:2,teacher:teachers[6]},
  {subject:'физкультура',scope:'class',hours:2,teacher:teachers[7]},
  {subject:'англ',scope:'group',groups:[1],hours:2,teacher:teachers[8]},
  {subject:'англ',scope:'group',groups:[2],hours:2,teacher:teachers[9]},
]}));
let res=null, tries=0;
for(let seed=1;seed<=200 && !res?.grid;seed++){ tries=seed; const r=generate(classes,teachers,5,7,seed); if(r.grid) res=r; }
if(!res?.grid) bad('генератор не нашёл сетку за 200 зёрен на данных первой школы');
else {
  const viol = verify(res, classes, 5, 7);
  if (viol.length===0) ok(`сетка первой школы (8 классов, англ по группам) найдена (зерно ${tries}); окон и полуокон нет — перечислением по ${5*7*8} ячейкам`);
  else { viol.slice(0,5).forEach(bad); note('генератор допускает полуокна — ограничение 4 спеки должно быть жёстким, найдено '+viol.length); }
}
// перегруженный педагог: один ведёт 36 часов при 35 слотах
const overT = classes.map(c=>({...c, pairs: c.pairs.map(p=>({...p, teacher:'Мария'}))}));
const rT = generate(overT, teachers, 5, 7, 1);
if (rT.code==='TEACHER_OVERBOOKED') ok(`один педагог на всё → ${rT.code} (${rT.hours} ч > ${rT.cap} слотов) арифметикой, без перебора`); else bad('перегруз педагога не пойман: '+JSON.stringify(rT));
note('НАХОДКА: групповые часы предмета планируются АТОМАРНОЙ спаренной единицей (один слот, два педагога) — первая версия модели с независимыми групповыми единицами не нашла сетку в принципе: требование к реализации генератора, внесено в спеку (ограничение 4).');
note('НАХОДКА: отказ TEACHER_OVERBOOKED обязан вычисляться арифметикой до перебора (сумма часов педагога > дни×слоты), иначе модератор получает неинформативный NO_SOLUTION после долгого перебора. В спеке код есть — порядок проверок уточнён: арифметические отказы (SANPIN, GRID, OVERBOOKED, UNCOVERED, UNASSIGNED, UNEQUAL) до запуска перебора.');

// ---------- P6. Материализация: праздники, горизонт ----------
console.log('P6. Материализация (AR-73)');
const holidays = ['2027-02-23','2027-03-08'];
const isWorkday = (d)=> d.getDay()>=1 && d.getDay()<=5 && !holidays.includes(d.toISOString().slice(0,10));
function materialize(templatePerDay, from, weeks){
  const lessons=[];
  const start = new Date(from);
  for(let i=0;i<weeks*7;i++){
    const d=new Date(start); d.setDate(start.getDate()+i);
    if(!isWorkday(d)) continue;
    const dow=(d.getDay()+6)%7;
    for(const u of (templatePerDay[dow]||[])) lessons.push({date:d.toISOString().slice(0,10), ...u});
  }
  return lessons;
}
const tpl = {0:[{slot:1},{slot:2}],1:[{slot:1}],2:[{slot:1}],3:[{slot:1}],4:[{slot:1}]};
const mat = materialize(tpl, '2027-02-22', 3);
if (!mat.some(l=>holidays.includes(l.date))) ok('материализация пропускает 23 февраля и 8 марта — мёртвых колонок в журнале нет (Д3)');
else bad('урок материализован на праздник');
const mondays = mat.filter(l=>l.date==='2027-02-22').length;
if (mondays===2) ok('понедельник с двумя уроками → 2 записи на дату → журнал даёт 2 колонки под одним числом'); else bad('двойной урок в дату потерян');

// ---------- P7. Журнал: гейт дат, деактивация ----------
console.log('P7. Журнал (AR-74, AR-78)');
const today='2027-03-01';
const postMark = (lessonDate, student)=> lessonDate>today ? {err:'LESSON_NOT_HELD'} : student.deactivated ? {err:'STUDENT_INACTIVE'} : {ok:true};
if (postMark('2027-03-02',{}).err==='LESSON_NOT_HELD') ok('отметка в завтрашний урок → LESSON_NOT_HELD (гейт в контракте)'); else bad('будущая отметка прошла');
if (postMark('2027-03-01',{}).ok) ok('текущий день — отметка принята'); else bad('текущий день отклонён');
if (postMark('2027-02-25',{deactivated:true}).err==='STUDENT_INACTIVE') ok('деактивированный ученик: новая отметка отклонена, история не тронута'); else bad('деактивация не держится');
// Средний балл — чтение, а не проекция (AR-115): считается по числовым отметкам
// строки, «н» и «б» в него не входят, отсутствие числовых даёт null, а не ноль.
const avg = (marks)=>{ const n=marks.filter(m=>['5','4','3','2'].includes(m)).map(Number); return n.length ? Number((n.reduce((a,b)=>a+b,0)/n.length).toFixed(2)) : null; };
if (avg(['5','4','н','б'])===4.5) ok('средний балл: «н» и «б» не участвуют — 5 и 4 дают 4.5'); else bad('средний балл считает нечисловые: '+avg(['5','4','н','б']));
if (avg(['н','б'])===null) ok('только «н» и «б» → среднего нет (null), а не ноль'); else bad('средний балл нулём вместо отсутствия');
if (avg([])===null) ok('пустая строка → среднего нет'); else bad('среднее у пустой строки');

note('НАХОДКА: гейт «текущий урок» в постановке — про уроки, а модель дат сравнивает дни. Урок сегодня в 14:00, отметка в 9:00 — урок ещё не прошёл. Принято [дефолт]: гейт по дате дня, не по времени слота (учитель заполняет журнал в течение дня свободно); сравнение по времени слота — кандидат на ужесточение в 1.1.x.');

// ---------- P8. Регенерация после ready: судьба уроков и отметок ----------
console.log('P8. Жизненный цикл сетки после подтверждения (AR-74, AR-85)');
const { regenerationPolicy, editEffects, wizard } = await import('./states.mjs');
function rematerialize(existing, nextKeys, policy){
  const lessons=[], events=[];
  for (const l of existing){
    if (nextKeys.has(l.key)) { lessons.push(l); continue; }
    if (policy==='detach-marked' && l.marks>0){ lessons.push({...l, detached:true}); events.push('schedule.lesson.detached.v1'); }
    // иначе урок исчезает вместе со старым шаблоном
  }
  return {lessons, events};
}
const wasLessons = [
  {key:'пн:1:5:матем', marks:12},   // проведён, отметки стоят — новый шаблон его не содержит
  {key:'пн:2:5:русск', marks:0},    // пустой урок, нового шаблона тоже нет
  {key:'вт:1:5:матем', marks:3},    // остаётся в новом шаблоне
];
const nextKeys = new Set(['вт:1:5:матем','ср:1:5:матем']);
const rem = rematerialize(wasLessons, nextKeys, regenerationPolicy);
const kept = rem.lessons.find(l=>l.key==='пн:1:5:матем');
if (kept?.detached) ok('регенерация: урок с отметками отвязан (detached), история не удалена');
else bad('регенерация уничтожает урок с выставленными отметками — история теряется');
if (rem.events.includes('schedule.lesson.detached.v1')) ok('журнал узнаёт об отвязке событием — колонок-призраков нет');
else bad('журнал подписан только на материализацию: об исчезновении урока не узнаёт');
if (!rem.lessons.some(l=>l.key==='пн:2:5:русск')) ok('урок без отметок исчезает вместе со старым шаблоном'); else bad('пустой урок пережил регенерацию');

// ---------- P9. Таксономия правок после ready ----------
console.log('P9. Что делает расписание устаревшим (AR-85)');
if (Array.isArray(editEffects) && editEffects.length) {
  const bogus = editEffects.filter(([,,target]) => !states.includes(target));
  if (!bogus.length) ok(`таксономия правок: ${editEffects.length} видов, у каждого назван исход`);
  else bad('правка ведёт в несуществующее состояние: '+bogus.map(e=>e[0]).join(', '));
  const roster = editEffects.filter(([name]) => /ученик/.test(name));
  if (roster.length && roster.every(([,affects,target]) => affects===false && target==='ready'))
    ok('правки контингента не роняют подтверждённую сетку в stale — отметки не под угрозой');
  else bad('добавление ученика переводит расписание в stale → регенерация ради нового ученика');
  const unbind = editEffects.find(([name]) => /открепить педагога/.test(name));
  if (unbind && unbind[1]===true && unbind[2]==='stale') ok('открепление педагога помечает сетку устаревшей — уроки без педагога видны');
  else bad('открепление педагога после ready: исход не определён');
  const hasIdle = transitions.some(([f,t,label]) => f==='ready' && t==='ready' && /правк/i.test(label));
  if (hasIdle) ok('в FSM есть правка, не выводящая из ready'); else bad('в FSM любая правка после ready ведёт в stale — таксономия правок не выражена');
} else bad('таксономия правок после ready не объявлена: editEffects отсутствует в states.mjs');

// ---------- P10. Класс из одного ученика и пустые группы ----------
console.log('P10. Крайний случай: класс из одного ученика (AR-75)');
if (wizard && typeof wizard.groupsFit === 'function') {
  if (wizard.groupsFit(15,2) && !wizard.groupsFit(1,2)) ok('мастер отклоняет 2 группы в классе из одного ученика');
  else bad('мастер допускает группу без учеников: класс 1 ученик × 2 группы');
  const one = split(Array.from({length:1},(_,i)=>({id:i})), 1);
  if (one.every(s=>s.group===1)) ok('класс из одного ученика без деления: единственная группа непуста'); else bad('разбиение сломалось на классе из одного ученика');
} else bad('правило «групп не больше, чем учеников» не объявлено: wizard.groupsFit отсутствует в states.mjs');

// ---------- P11. Права: модератор против педагога (AR-88) ----------
console.log('P11. Полномочия модератора и гейты реальности');
const st = await import('./states.mjs');
if (typeof st.markGate === 'function') {
  const lesson = { date:'2027-02-25', teacherId:'t-anna' };
  const future = { date:'2027-03-02', teacherId:'t-anna' };
  if (st.markGate(['moderator'],'u-mod', lesson, today)==='ok') ok('модератор ставит отметку в чужом уроке — права полные (AR-88)');
  else bad('модератор не может поставить отметку в чужом уроке');
  if (st.markGate(['teacher'],'t-anna', lesson, today)==='ok') ok('педагог ставит отметку в своём уроке'); else bad('педагог не может поставить отметку в своём уроке');
  if (st.markGate(['teacher'],'t-oleg', lesson, today)==='FORBIDDEN') ok('педагог в чужом уроке — отказ'); else bad('чужой урок открыт педагогу на запись');
  if (st.markGate(['director'],'u-dir', lesson, today)==='FORBIDDEN') ok('читающая роль отметку не ставит'); else bad('директор пишет в журнал');
  if (st.markGate(['moderator'],'u-mod', future, today)==='LESSON_NOT_HELD')
    ok('модератор не обходит гейт даты: непроведённый урок закрыт и для полных прав — это факт, а не право');
  else bad('полные права обходят гейт непроведённого урока');
} else bad('правила прав не объявлены: markGate отсутствует в states.mjs');

// ---------- P12. У каждой операции есть обратная либо названная причина ----------
console.log('P12. Обратимость операций (AR-90)');
if (Array.isArray(st.reversals) && st.reversals.length) {
  const mute = st.reversals.filter(([, back, why]) => !back && !why);
  if (!mute.length) ok(`обратимость: ${st.reversals.length} операций, у каждой названа обратная либо причина её отсутствия`);
  else bad('операции без обратной и без причины: ' + mute.map((r) => r[0]).join(', '));
  const need = ['создать класс','создать предмет','деактивировать ученика','добавить роль','зарегистрировать сотрудника','подтвердить сетку','поставить отметку','запустить генерацию','загрузить аватар','привязать педагога'];
  const missing = need.filter((n) => !st.reversals.some(([op]) => op === n));
  if (!missing.length) ok('каждая создающая операция версии присутствует в таблице обратимости');
  else bad('операции вне таблицы обратимости: ' + missing.join(', '));
  // Второй детектор L-9: разрушающая операция опаснее создающей, и именно её
  // легче забыть — она попадает в реестр только как «обратная» к созданию.
  const destructive = ['удалить класс','удалить предмет','удалить ученика','удалить сотрудника','снять роль','открепить педагога'];
  const gone = destructive.filter((n) => !st.reversals.some(([op]) => op === n));
  if (!gone.length) ok('каждая разрушающая операция версии присутствует в таблице обратимости своей строкой');
  else bad('разрушающие операции вне таблицы обратимости: ' + gone.join(', '));
} else bad('таблица обратимости не объявлена: reversals отсутствует в states.mjs');

// ---------- P13. Удаление сотрудника: каскад и защита школы ----------
console.log('P13. Удаление и деактивация сотрудника (AR-89)');
if (typeof st.staffRemoval === 'function') {
  const school = { moderators: 1 };
  const one = st.staffRemoval({ roles:['moderator'], hasHistory:false }, school);
  if (one.code === 'LAST_MODERATOR') ok('последний модератор не удаляется — школа не остаётся без управления');
  else bad('последнего модератора можно удалить: ' + JSON.stringify(one));
  const teacher = st.staffRemoval({ roles:['teacher'], hasHistory:true }, { moderators:2 });
  if (teacher.action === 'deactivate' && teacher.keepsMarks) ok('педагог с историей деактивируется, отметки остаются на месте');
  else bad('педагог с историей удаляется вместе с историей: ' + JSON.stringify(teacher));
  const fresh = st.staffRemoval({ roles:['teacher'], hasHistory:false }, { moderators:2 });
  if (fresh.action === 'delete' && fresh.unbinds && fresh.staleSchedule)
    ok('педагог без истории удаляется: привязки сняты, сетка помечена устаревшей');
  else bad('удаление педагога без истории не описано каскадом: ' + JSON.stringify(fresh));
  const secondMod = st.staffRemoval({ roles:['moderator'], hasHistory:false }, { moderators:2 });
  if (secondMod.action === 'delete') ok('второй модератор удаляется — правило защищает школу, а не должность'); else bad('второй модератор защищён ошибочно');
} else bad('правила удаления сотрудника не объявлены: staffRemoval отсутствует в states.mjs');

// ---------- P14. Маршруты входа без SMS: якорная сессия и привязка устройств ----------
console.log('P14. Как сотрудник попадает в кабинет (AR-94: без SMS)');
if (typeof st.loginRoute === 'function') {
  const R = (o) => st.loginRoute(o).route;
  if (R({justRegistered:true, ownDevice:true}) === 'session-from-registration')
    ok('регистрация со своего телефона заканчивается сессией 90 дней — телефон становится якорным устройством');
  else bad('после QR-регистрации сотрудник не получает сессию');
  if (R({justRegistered:true, ownDevice:false}) !== 'session-from-registration')
    ok('регистрация с устройства модератора сессии сотруднику не создаёт');
  else bad('сессия сотрудника создаётся на устройстве модератора');
  if (R({hasAnchorSession:true, newDevice:true}) === 'device-link')
    ok('вход с ноутбука при живом телефоне — привязка устройства: QR на ноутбуке, скан из настроек телефона');
  else bad('повторный вход с нового устройства не определён без SMS');
  if (R({hasAnchorSession:false, moderatorPresent:true}) === 'login-code')
    ok('якорной сессии нет (телефон потерян/куки стёрты), модератор рядом → код с карточки: QR и шесть цифр');
  else bad('восстановление без якорной сессии не определено');
  const dead = st.loginRoute({hasAnchorSession:false, moderatorPresent:false});
  if (dead.route === 'none' && /модератор/.test(dead.reason))
    ok('якоря нет и модератора нет → входа нет, причина отправляет к модератору, а не «попробуйте позже»');
  else bad('тупик входа не назван честно');
  if (R({deactivated:true}) === 'none' && st.loginRoute({deactivated:true}).revokesSessions)
    ok('деактивация закрывает все маршруты и отзывает живые сессии немедленно');
  else bad('деактивация не закрывает вход или оставляет сессию');
  if (R({bootstrap:true}) === 'bootstrap-link') ok('первый модератор школы — одноразовая ссылка платформенной операции');
  else bad('корня графа онбординга нет');
  if (R({lastModeratorNoSession:true}) === 'bootstrap-relink')
    ok('единственный модератор потерял телефон → платформа перевыпускает ссылку — школа не запирается навсегда');
  else bad('потеря телефона единственным модератором — вечный тупик');
} else bad('маршруты входа не объявлены: loginRoute отсутствует в states.mjs');

// ---------- P15. FSM привязки устройства (AR-94, паттерн Telegram) ----------
console.log('P15. Привязка устройства по QR');
if (st.deviceLink && typeof st.deviceLink.approve === 'function') {
  const D = st.deviceLink;
  if (D.ttlMinutes <= 3) ok(`токен привязки живёт ${D.ttlMinutes} мин — QR на экране входа не залёживается`); else bad('TTL токена привязки не ограничен');
  const okCase = D.approve({token:{state:'waiting'}, scanner:{deactivated:false, workspaceId:'ws-1'}});
  if (okCase.ok && okCase.session.workspaceId==='ws-1')
    ok('скан выдаёт новому устройству сессию той же школы и тех же ролей, что у сканирующего');
  else bad('привязка не наследует школу сканирующего: '+JSON.stringify(okCase));
  if (D.approve({token:{state:'approved'}, scanner:{workspaceId:'ws-1'}}).code==='TOKEN_USED')
    ok('токен одноразов: повторный скан — отказ'); else bad('токен привязки переиспользуем');
  if (D.approve({token:{state:'expired'}, scanner:{workspaceId:'ws-1'}}).code==='LINK_CODE_EXPIRED')
    ok('просроченный токен — именованный отказ, страница входа перевыпускает QR сама'); else bad('просроченный токен не различим');
  if (D.approve({token:{state:'waiting'}, scanner:{deactivated:true}}).code==='ACCESS_REVOKED')
    ok('деактивированный не может привязать устройство — сканер проверяется, не только токен'); else bad('деактивированный привязывает устройства');
  if (D.revoke({session:{id:'s2'}, by:'owner'}).only==='s2')
    ok('завершение сессии из настроек убивает ровно её — остальные устройства живут'); else bad('отзыв сессии не адресный');
} else bad('FSM привязки устройства не объявлен: deviceLink отсутствует в states.mjs');

// ---------- P16. Календарь нерабочих дней и материализация ----------
console.log('P16. Нерабочие дни и скользящая материализация (AR-100, AR-101)');
if (st.calendar && typeof st.calendar.nonWorking === 'function' && typeof st.materialize === 'function') {
  const y = st.calendar.nonWorking(2026);
  if (Array.isArray(y) && y.length) ok(`справочник нерабочих дней на 2026 загружен: ${y.length} дат — генератор не угадывает праздники`);
  else bad('справочник нерабочих дней пуст: источник праздников не назван');
  const missing = st.calendar.check(2099);
  if (missing.code === 'CALENDAR_YEAR_MISSING') ok('год без данных календаря — именованный отказ, а не тихий пропуск праздников');
  else bad('отсутствие календаря на год проходит молча');
  const r1 = st.materialize({ from:'2026-02-20', weeks:3, perDay:{0:[{slot:1}],1:[{slot:1}]} });
  if (!r1.lessons.some(l => y.includes(l.date))) ok('материализация не создаёт уроки в нерабочие дни'); else bad('урок материализован в праздник');
  const r2 = st.materialize({ from:'2026-02-20', weeks:3, perDay:{0:[{slot:1}],1:[{slot:1}]}, existing:r1.lessons });
  if (r2.created === 0) ok('повторный прогон идемпотентен: дублей нет — значит все три триггера безопасны'); else bad(`повторный прогон создал ${r2.created} дублей`);
  if (Array.isArray(st.materialize.triggers) && st.materialize.triggers.length === 3)
    ok(`триггеры материализации названы: ${st.materialize.triggers.join(', ')}`);
  else bad('кто и когда двигает горизонт материализации — не названо');
} else bad('календарь и материализация не объявлены: calendar/materialize отсутствуют в states.mjs');

// ---------- P17. Второй модератор ----------
console.log('P17. Как в школе появляется второй модератор (AR-102)');
if (typeof st.roleChange === 'function') {
  const grant = st.roleChange({ op:'add', role:'moderator', person:{roles:['teacher']}, school:{moderators:1} });
  if (grant.ok && grant.roles.includes('moderator')) ok('роль модератора выдаётся зарегистрированному сотруднику кнопкой «Добавить роль»');
  else bad('второго модератора завести нечем: '+JSON.stringify(grant));
  const strip = st.roleChange({ op:'remove', role:'moderator', person:{roles:['moderator']}, school:{moderators:1} });
  if (strip.code === 'LAST_MODERATOR') ok('снятие роли у последнего модератора — отказ, школа не остаётся без управления');
  else bad('последний модератор лишается роли и школа запирается');
  const strip2 = st.roleChange({ op:'remove', role:'moderator', person:{roles:['moderator','teacher']}, school:{moderators:2} });
  if (strip2.ok) ok('при двух модераторах роль снимается свободно'); else bad('второй модератор не снимается');
  const last = st.roleChange({ op:'remove', role:'teacher', person:{roles:['teacher']}, school:{moderators:2} });
  if (last.code === 'LAST_ROLE') ok('последняя роль сотрудника не снимается — для закрытия доступа есть деактивация'); else bad('сотрудник остаётся без единой роли');
} else bad('правила смены ролей не объявлены: roleChange отсутствует в states.mjs');

// ---------- P18. Дневная сетка: число уроков в день и длина дня (AR-103) ----------
console.log('P18. Дневная сетка: слоты и минуты (AR-103)');
if (st.dayGrid && typeof st.dayGrid.validate === 'function') {
  const dg = st.dayGrid;
  // Уроков в день — вход генератора: без него не считаются ни LOAD_EXCEEDS_GRID,
  // ни TEACHER_OVERBOOKED (оба про «слоты недели» = дни × слоты).
  if (typeof dg.cap === 'function' && dg.cap(5) > 0 && dg.cap(11) >= dg.cap(5))
    ok(`дневной потолок уроков задан по параллелям: 5 класс — ${dg.cap(5)}, 11 класс — ${dg.cap(11)}`);
  else bad('дневной потолок уроков не задан по параллелям — ограничение 7 не с чем сверять');
  const over = dg.validate({ parallel: 5, slotsPerDay: 9, lessonMin: 45, breakMin: 10, bigBreakAfter: 2, bigBreakMin: 30 });
  if (over?.code === 'DAY_EXCEEDS_SANPIN') ok(`9 уроков в 5 классе → ${over.code} (потолок ${over.cap}) — отказ до перебора`);
  else bad('дневной перегруз не пойман: ' + JSON.stringify(over));
  // Минуты: четыре временных параметра экрана 4 обязаны хоть чем-то потребляться.
  const longDay = dg.validate({ parallel: 11, slotsPerDay: 7, lessonMin: 45, breakMin: 90, bigBreakAfter: 2, bigBreakMin: 30 });
  if (longDay?.code === 'DAY_TOO_LONG') ok(`перемена 90 мин → ${longDay.code} (${longDay.minutes} мин при потолке ${longDay.cap}) — длина дня проверяется арифметикой`);
  else bad('учебный день неограниченной длины проходит валидацию: ' + JSON.stringify(longDay));
  const sane = dg.validate({ parallel: 7, slotsPerDay: 7, lessonMin: 45, breakMin: 10, bigBreakAfter: 2, bigBreakMin: 30 });
  if (sane === null) ok('штатный день (7 уроков × 45 мин, перемены 10, большая 30) проходит'); else bad('ложный отказ на штатном дне: ' + JSON.stringify(sane));
  if (Array.isArray(dg.consumes) && dg.consumes.length === 4)
    ok('все четыре временных параметра экрана 4 названы потребителем: ' + dg.consumes.join(', '));
  else bad('временные параметры экрана 4 не потребляются ничем — мёртвый ввод');

  // AR-114: одно число на школу, потолок — по каждой параллели отдельно.
  if (typeof dg.classCap === 'function' && typeof dg.schoolCap === 'function') {
    const school = [1, 2, 5, 8]; // школа, где есть и первоклассники, и восьмиклассники
    const mixed = dg.validate({ parallels: school, slotsPerDay: 7, lessonMin: 45, breakMin: 10, bigBreakAfter: 2, bigBreakMin: 30 });
    if (mixed === null) ok(`школа с параллелями ${school.join(', ')} принимает 7 уроков в день: потолок школы — ${dg.schoolCap(school)}`);
    else bad('школа с первым и восьмым классом не может задать «уроков в день»: ' + JSON.stringify(mixed));
    if (dg.classCap(1, 7) === 4 && dg.classCap(8, 7) === 7)
      ok(`потолок применяется к каждой параллели: 1 класс — ${dg.classCap(1, 7)} урока в день, 8 класс — ${dg.classCap(8, 7)}`);
    else bad('дневной потолок параллели не применяется поклассно — норма СанПиН нормирует параллель, а не школу');
    const tooMany = dg.validate({ parallels: school, slotsPerDay: 8, lessonMin: 45, breakMin: 10, bigBreakAfter: 2, bigBreakMin: 30 });
    if (tooMany?.code === 'DAY_EXCEEDS_SANPIN')
      ok(`8 уроков в день выше потолка самой старшей параллели (${tooMany.cap}) → ${tooMany.code}`);
    else bad('число уроков выше любого потолка школы проходит валидацию');
    // недельная сетка класса считается от ЕГО потолка: 20 слотов у первого, 35 у восьмого
    const grid = (p) => 5 * dg.classCap(p, 7);
    if (grid(1) === 20 && grid(8) === 35)
      ok(`слоты недели считаются поклассно: 1 класс — ${grid(1)}, 8 класс — ${grid(8)} (LOAD_EXCEEDS_GRID больше не неустраним)`);
    else bad('слоты недели считаются от школьного числа, а не от потолка класса');
  } else bad('поклассный потолок не объявлен: dayGrid.classCap/schoolCap отсутствуют в states.mjs (AR-114)');
} else bad('дневная сетка не объявлена: dayGrid отсутствует в states.mjs — «уроков в день» не имеет источника');

// ---------- P19. Стык с физической схемой: домен (AR-104) ----------
console.log('P19. Стык спеки с физической схемой (AR-104)');
if (st.schemaFit && Array.isArray(st.schemaFit.domain)) {
  const dom = st.schemaFit.domain;
  const mute = dom.filter((t) => !t.plan);
  if (!mute.length) ok(`11 доменных таблиц: у каждой назван план против физической схемы (${dom.length} строк)`);
  else bad('доменные таблицы без плана против существующей схемы: ' + mute.map((t) => t.table).join(', '));
  const collisions = dom.filter((t) => t.collides);
  if (collisions.length >= 3) ok('коллизии имён названы поимённо: ' + collisions.map((t) => t.table).join(', '));
  else bad('коллизии имён с legacy-схемой не перечислены — Prisma не допустит двух моделей с одним именем');
  const named = collisions.every((t) => t.legacyOwner);
  if (named) ok('у каждой коллизии назван владелец существующей таблицы — видно, чей контур трогаем');
  else bad('коллизия без владельца: непонятно, чей код сломает переименование');
} else bad('стык с физической схемой не объявлен: schemaFit.domain отсутствует в states.mjs');

// ---------- P20. Стык с физической схемой: контур доступа (AR-104) ----------
console.log('P20. Контур доступа против существующих таблиц (AR-104)');
if (st.schemaFit && Array.isArray(st.schemaFit.access)) {
  const acc = st.schemaFit.access;
  const reused = acc.filter((t) => t.status === 'существующая');
  const unnamed = reused.filter((t) => !Array.isArray(t.missing));
  if (!unnamed.length) ok(`переиспользуемые таблицы (${reused.map((t) => t.table).join(', ')}): недостающие поля перечислены`);
  else bad('таблица объявлена переиспользуемой без перечня недостающих полей: ' + unnamed.map((t) => t.table).join(', '));
  const user = acc.find((t) => t.table === 'User');
  if (user && user.missing.some((f) => /^phone/.test(f))) ok('User: телефон назван недостающим полем — вход по коду и bootstrap опираются на него');
  else bad('User объявлен носителем телефона, а поля нет — вход по коду не на чем построить');
  const mem = acc.find((t) => t.table === 'Membership');
  if (mem && mem.missing.some((f) => /roles/.test(f))) ok('Membership: массив ролей назван недостающим — совмещение ролей (AR-60) одной строкой не выражается');
  else bad('Membership объявлен носителем массива ролей, а физически несёт одну строку florusRole');
  const ws = acc.find((t) => t.table === 'Workspace');
  if (ws && Array.isArray(ws.blockers) && ws.blockers.length) ok('Workspace: обязательные связи названы (' + ws.blockers.join(', ') + ') — bootstrap знает, что создаёт');
  else bad('Workspace создаётся bootstrap-ом, но обязательные связи не названы');
} else bad('стык контура доступа с физической схемой не объявлен: schemaFit.access отсутствует в states.mjs');

console.log(fails? `\n❌ Свойства: ${fails} падений` : '\n✅ Свойства: все инварианты держатся.');
if (notes.length){ console.log('\nЗаметки для 40-bench.md:'); notes.forEach(n=>console.log('  · '+n)); }
process.exit(fails?1:0);
