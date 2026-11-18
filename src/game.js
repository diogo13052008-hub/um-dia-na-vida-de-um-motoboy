/** All money is in integer cents; distance is in tenths of a kilometre. */
export const MINIMUM_HOURLY_CENTS_2026 = 737;
export const DAY_START = 8 * 60;
export const DAY_END = 13 * 60 + 38; // fim do recorte: 08:00–13:38
export const RULES = Object.freeze({fuelCentsPerKm:20, maintenanceCentsPerKm:10, mealCents:2500, otherCents:500, referenceYear:2026, reportedGrossHourlyCents:3007, cebrapNetHourlyLowCents:1700, cebrapNetHourlyHighCents:2200});

/** Trajetos e distâncias da atividade anterior (estimativas, não rotas verificadas).
 * Pagamentos e horários são valores HIPOTÉTICOS de um cenário com adicionais variáveis,
 * calibrado apenas para ilustrar uma faixa HORÁRIA, NÃO extraídos de pedidos reais.
 * Esta amostra cobre 08:00–13:38, não um expediente integral de 10 horas.
 */
export const TRIPS = Object.freeze([
  { id:1, at:'08:05', pickup:'Av. Paulista, 1578 — Bela Vista', dropoff:'Rua Augusta, 2000 — Jardins', kmTenths:22, cents:1200, minutes:18, story:'Primeira oferta do período. A taxa mínima existe, mas essa proposta hipotética inclui um adicional por demanda.', start:[419,201], end:[348,190]},
  { id:2, at:'08:30', pickup:'Av. Ibirapuera, 3103 — Moema', dropoff:'Av. Santo Amaro, 4500 — Brooklin', kmTenths:41, cents:1500, minutes:28, story:'Semáforos e espera na coleta pesam no tempo. O pagamento desta oferta simulada é superior ao mínimo por rota.', start:[472,361], end:[335,440]},
  { id:3, at:'09:05', pickup:'Rua Vergueiro, 2541 — Vila Mariana', dropoff:'Av. Paulista, 900 — Bela Vista', kmTenths:48, cents:1700, minutes:32, story:'Uma rota urbana com preço hipotético que varia conforme região e demanda; não é tarifa oficial nem média observada.', start:[477,292], end:[445,209]},
  { id:4, at:'09:45', pickup:'Av. Brigadeiro Faria Lima, 2232 — Jardim Paulistano', dropoff:'Rua João Cachoeira, 500 — Itaim Bibi', kmTenths:28, cents:1400, minutes:22, story:'Uma entrega mais curta, mas que ainda envolve retirada, portaria e trânsito. Aceitar ou recusar muda seu resultado.', start:[242,248], end:[325,307]},
  { id:5, at:'10:15', pickup:'Av. dos Bandeirantes, 3600 — Planalto Paulista', dropoff:'Av. Jabaquara, 1500 — Saúde', kmTenths:53, cents:1900, minutes:35, story:'O valor ofertado sobe com a distância e um adicional simulado. Combustível e desgaste seguem por sua conta.', start:[493,410], end:[541,342]},
  { id:6, at:'11:00', pickup:'Av. Rebouças, 3970 — Pinheiros', dropoff:'Av. Sumaré, 1200 — Perdizes', kmTenths:67, cents:2300, minutes:42, story:'Uma entrega mais demorada e com pagamento maior. Compare o valor da oferta com o tempo efetivamente gasto.', start:[219,237], end:[310,113]},
  { id:7, at:'11:50', pickup:'Av. Paulista, 2073 — Consolação', dropoff:'Rua Cerro Corá, 1000 — Alto da Lapa', kmTenths:84, cents:2800, minutes:52, story:'A proposta hipotética inclui um adicional alto, não garantido no aplicativo. Mais valor exige mais tempo de moto.', start:[356,174], end:[190,119]},
  { id:8, at:'12:50', pickup:'Av. Interlagos, 2255 — Jardim Marajoara', dropoff:'Av. Washington Luís, 3000 — Campo Belo', kmTenths:72, cents:2500, minutes:48, story:'Última oferta deste recorte, com adicional ilustrativo de horário de almoço. Despesas fixas ainda precisam ser pagas.', start:[361,538], end:[386,383]}
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
