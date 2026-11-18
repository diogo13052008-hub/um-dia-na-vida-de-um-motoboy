/** All money is in integer cents; distance is in tenths of a kilometre. */
export const MINIMUM_HOURLY_CENTS_2026 = 737;
export const DAY_START = 8 * 60;
export const DAY_END = 18 * 60;
export const RULES = Object.freeze({fuelCentsPerKm:20, maintenanceCentsPerKm:10, mealCents:2500, otherCents:500, referenceYear:2026});

/** Routes are pedagogical estimates, not actual offers or validated routing distances. */
export const TRIPS = Object.freeze([
  { id:1, at:'08:15', pickup:'Av. Paulista, 1578 — Bela Vista', dropoff:'Rua Augusta, 2000 — Jardins', kmTenths:22, cents:750, minutes:18, story:'O movimento da Paulista já começou. Uma viagem curta parece compensar, mas semáforos e espera no restaurante consomem minutos.', start:[419,201], end:[348,190]},
  { id:2, at:'09:00', pickup:'Av. Ibirapuera, 3103 — Moema', dropoff:'Av. Santo Amaro, 4500 — Brooklin', kmTenths:41, cents:750, minutes:28, story:'O bairro está cheio de cruzamentos e carros. A oferta é um pouco mais distante, mas o valor não muda.', start:[472,361], end:[335,440]},
  { id:3, at:'10:10', pickup:'Rua Vergueiro, 2541 — Vila Mariana', dropoff:'Av. Paulista, 900 — Bela Vista', kmTenths:48, cents:750, minutes:32, story:'O trecho inclui avenidas congestionadas e uma subida. As despesas da moto seguem por sua conta.', start:[477,292], end:[445,209]},
  { id:4, at:'11:00', pickup:'Av. Brigadeiro Faria Lima, 2232 — Jardim Paulistano', dropoff:'Rua João Cachoeira, 500 — Itaim Bibi', kmTenths:28, cents:750, minutes:22, story:'É hora do almoço. O aplicativo oferece uma entrega rápida, mas você ainda precisa buscar o pedido.', start:[242,248], end:[325,307]},
  { id:5, at:'13:00', pickup:'Av. dos Bandeirantes, 3600 — Planalto Paulista', dropoff:'Av. Jabaquara, 1500 — Saúde', kmTenths:53, cents:795, minutes:35, story:'Você ainda não parou para almoçar. Uma rota maior significa mais combustível consumido.', start:[493,410], end:[541,342]},
  { id:6, at:'14:15', pickup:'Av. Rebouças, 3970 — Pinheiros', dropoff:'Av. Sumaré, 1200 — Perdizes', kmTenths:67, cents:1005, minutes:42, story:'A tarde avança. Uma entrega de maior valor também cobra mais tempo e desgaste da motocicleta.', start:[219,237], end:[310,113]},
  { id:7, at:'16:00', pickup:'Av. Paulista, 2073 — Consolação', dropoff:'Rua Cerro Corá, 1000 — Alto da Lapa', kmTenths:84, cents:1260, minutes:52, story:'O trânsito do fim da tarde aperta. O valor parece alto, mas o deslocamento é longo.', start:[356,174], end:[190,119]},
  { id:8, at:'17:15', pickup:'Av. Interlagos, 2255 — Jardim Marajoara', dropoff:'Av. Washington Luís, 3000 — Campo Belo', kmTenths:72, cents:1080, minutes:48, story:'Depois de tantas horas disponível, você recebe a última oferta. Aceitar pode prolongar o expediente.', start:[361,538], end:[386,383]}
]);

export function timeToMinutes(hhmm) {
  const [h,m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}
export function minutesToClock(minute){
  return `${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`;
}

/** Player decisions are stored as {step, accepted}; step is zero-based. */
export function computeMetrics(decisions = [], phase = 'playing', currentStep = 0) {
  let grossCents = 0, kmTenths = 0, movingMinutes = 0, lastEnd = DAY_START, acceptedCount = 0;
  const answered = new Set();
  for (const entry of decisions) {
    const step = Number(entry.step);
    if (!Number.isInteger(step) || step < 0 || step >= TRIPS.length || answered.has(step)) continue;
    answered.add(step);
    if (Boolean(Number(entry.accepted))) {
      const trip = TRIPS[step];
      grossCents += trip.cents;
      kmTenths += trip.kmTenths;
      movingMinutes += trip.minutes;
      acceptedCount++;
      lastEnd = Math.max(lastEnd, timeToMinutes(trip.at) + trip.minutes);
    }
  }
  const finished = answered.size === TRIPS.length;
  const variableFuelCents = kmTenths * 2;
  const variableMaintenanceCents = kmTenths;
  const fixedCents = phase === 'lobby' ? 0 : RULES.mealCents + RULES.otherCents;
  const costCents = variableFuelCents + variableMaintenanceCents + fixedCents;
  const netCents = grossCents - costCents;
  const offeringClock = phase === 'lobby' ? DAY_START : timeToMinutes(TRIPS[Math.min(currentStep,7)].at);
  const clockMinute = phase === 'results' ? Math.max(DAY_END, lastEnd) : Math.max(offeringClock, lastEnd);
  const workMinutes = Math.max(0, (phase === 'results' || finished ? Math.max(DAY_END,lastEnd) : clockMinute) - DAY_START);
  const hourlyCents = workMinutes > 0 ? Math.round(netCents * 60 / workMinutes) : 0;
  return { answered: answered.size, finished, acceptedCount, grossCents, kmTenths, movingMinutes, fuelCents: variableFuelCents,
    maintenanceCents: variableMaintenanceCents, mealCents: phase === 'lobby' ? 0 : RULES.mealCents,
    otherCents: phase === 'lobby' ? 0 : RULES.otherCents, costCents, netCents, clockMinute, workMinutes,
    waitingMinutes: Math.max(0,workMinutes - movingMinutes), hourlyCents };
}

export function averageResults(players) {
  const complete = players.filter(p => p.active && p.metrics.finished);
  const count = complete.length;
  if (!count) return null;
  const fields = ['grossCents','costCents','netCents','kmTenths','workMinutes','movingMinutes','hourlyCents','fuelCents','maintenanceCents','mealCents','otherCents'];
  const averages = Object.fromEntries(fields.map(key => [key, complete.reduce((total,p) => total + p.metrics[key],0)/count]));
  const totals = Object.fromEntries(fields.map(key => [key, complete.reduce((total,p) => total + p.metrics[key],0)]));
  return { count, averages, totals };
}
