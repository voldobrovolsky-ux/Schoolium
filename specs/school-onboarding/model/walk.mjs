// Обход FSM перечислением: недостижимые, тупики, путь к терминалу, дом, актор.
import { states, initial, terminals, transitions, home } from './states.mjs';
const errs = [];
const out = new Map(states.map(s=>[s,[]]));
const inn = new Map(states.map(s=>[s,[]]));
for (const [f,t] of transitions) {
  if (!states.includes(f)) errs.push(`переход из неизвестного состояния ${f}`);
  if (!states.includes(t)) errs.push(`переход в неизвестное состояние ${t}`);
  out.get(f).push(t); inn.get(t).push(f);
}
// достижимость от начального
const seen = new Set([initial]); const q=[initial];
while(q.length){ for(const t of out.get(q.shift())) if(!seen.has(t)){seen.add(t);q.push(t);} }
for (const s of states) if (!seen.has(s)) errs.push(`недостижимо: ${s}`);
// тупики
for (const s of states) if (!terminals.includes(s) && out.get(s).filter(t=>t!==s).length===0)
  errs.push(`тупик: ${s} — нет выхода, но не терминал`);
// путь к терминалу из каждого состояния
const canReach = new Set(terminals); let grew=true;
while(grew){ grew=false; for(const s of states) if(!canReach.has(s) && out.get(s).some(t=>canReach.has(t))){canReach.add(s);grew=true;} }
for (const s of states) if (!canReach.has(s)) errs.push(`нет пути к терминалу из: ${s}`);
// дом на экране
for (const s of states) if (!home[s]) errs.push(`нет дома на экране: ${s}`);
// каждый переход имеет актора; system-* не завершает без человека (AR-18)
for (const [f,t,label,actor] of transitions){
  if (!actor) errs.push(`переход ${f}→${t} без актора`);
  if (actor==='system-proposes' && terminals.includes(t)) errs.push(`система завершает онбординг сама: ${f}→${t}`);
}
console.log(`FSM: ${states.length} состояний, ${transitions.length} переходов; достижимо ${seen.size}, путь к терминалу у ${canReach.size}.`);
if (errs.length){ console.error('❌ '+errs.length+' дыр:'); errs.forEach(e=>console.error('  · '+e)); process.exit(1); }
console.log('✅ Обход FSM: недостижимых нет, тупиков нет, у каждого состояния есть дом и путь к терминалу; терминал достигается только человеком.');
