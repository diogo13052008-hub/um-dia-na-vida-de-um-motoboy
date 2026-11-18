import express from 'express';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Server } from 'socket.io';
import QRCode from 'qrcode';
import { Storage, UserError } from './src/storage.js';
import { TRIPS, RULES, computeMetrics, averageResults, MINIMUM_HOURLY_CENTS_2026 } from './src/game.js';

const __dirname=dirname(fileURLToPath(import.meta.url));
const store=new Storage();
await store.init();
const app=express();
app.disable('x-powered-by');
app.set('trust proxy',1);
app.use((req,res,next)=>{res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');next();});
app.get('/health',(req,res)=>res.json({ok:true,app:'Motoboy',at:new Date().toISOString()}));
// QR gerado no próprio servidor: a URL contém apenas o código público de entrada, nunca o token do administrador.
app.get('/api/qr/:code.svg',async (req,res)=>{
  const {code}=req.params;
  if (!/^\d{6}$/.test(code)) return res.status(400).type('text/plain').send('Código inválido');
  try {
    const origin=process.env.PUBLIC_BASE_URL?.replace(/\/$/,'') || `${req.protocol}://${req.get('host')}`;
    const invitation=new URL('/',origin);
    invitation.searchParams.set('s',code);
    invitation.searchParams.set('participar','1');
    const svg=await QRCode.toString(invitation.toString(),{
      type:'svg',width:360,margin:2,errorCorrectionLevel:'M',
      color:{dark:'#0b292b',light:'#ffffff'}
    });
    res.set('Cache-Control','public, max-age=300');
    res.type('image/svg+xml').send(svg);
  } catch(error) {
    console.error('Erro ao gerar QR Code:',error);
    res.status(500).type('text/plain').send('Não foi possível gerar o QR Code.');
  }
});

app.use(express.static(join(__dirname,'public'),{index:'index.html'}));
app.get('*',(req,res)=>res.sendFile(join(__dirname,'public','index.html')));
const httpServer=createServer(app);
const io=new Server(httpServer,{transports:['websocket'],maxHttpBufferSize:12000,pingTimeout:25000});

if(process.env.REDIS_URL) {
  const {createAdapter}=await import('@socket.io/redis-adapter');
  const {createClient}=await import('redis');
  const pub=createClient({url:process.env.REDIS_URL});
  const sub=pub.duplicate();
  await Promise.all([pub.connect(),sub.connect()]);
  io.adapter(createAdapter(pub,sub));
  console.log('Sincronização entre instâncias: Redis habilitado.');
}

function asView(snapshot) {
  const {room}=snapshot;
  const players=snapshot.players.map(p=>({...p,metrics:computeMetrics(p.decisions,room.phase,room.step)}));
  const active=players.filter(p=>p.active);
  const answered=active.filter(p=>p.decisions.some(d=>d.step===room.step)).length;
  const finished=active.filter(p=>p.metrics.finished).length;
  const averages=room.phase==='results'?averageResults(players):null;
  const roster=players.map(p=>({id:p.id,nickname:p.nickname,active:p.active,answered:p.metrics.answered,finished:p.metrics.finished,
    respondedCurrent:p.decisions.some(d=>d.step===room.step)}));
  const resultPlayers=room.phase==='results'?active.filter(p=>p.metrics.finished).map(p=>({id:p.id,nickname:p.nickname,metrics:p.metrics,decisions:p.decisions})):null;
  const common={...room,trips:TRIPS,rules:RULES,minimumHourlyCents:MINIMUM_HOURLY_CENTS_2026,
    participants:active.length,removed:players.length-active.length,answered,finished,roster,averages,resultPlayers,
    canAdvance:room.phase==='playing'&&active.length>0&&answered===active.length};
  return {common, players};
}

async function broadcast(code) {
  const snapshot=await store.snapshot(code);
  if(!snapshot)return;
  const view=asView(snapshot);
  io.to(`room:${code}`).emit('room:public',view.common);
  io.to(`admin:${code}`).emit('room:admin',{players:view.players});
  for(const p of view.players) io.to(`player:${code}:${p.id}`).emit('room:private',{id:p.id,nickname:p.nickname,active:p.active,metrics:p.metrics,decisions:p.decisions});
}

const socketErrors=err=>({ok:false,error:err instanceof UserError?err.message:'Ocorreu um erro no servidor. Tente novamente.'});
function event(socket,name,handler) {
  socket.on(name,async (input={},ack=()=>{})=>{
    try {
      if(typeof ack!=='function')return;
      const now=Date.now(), throttle=socket.data.throttle || {time:now,count:0};
      if(now-throttle.time>10000) {throttle.time=now;throttle.count=0;}
      if(++throttle.count>65) throw new UserError('Muitas solicitações. Aguarde alguns segundos.');
      socket.data.throttle=throttle;
      if(!input || typeof input!=='object' || Array.isArray(input)) throw new UserError('Solicitação inválida.');
      const response=await handler(input);
      ack({ok:true,...response});
    } catch(err) {
      if(!(err instanceof UserError)) console.error(`Falha em ${name}`,err);
      try { ack(socketErrors(err)); } catch {}
    }
  });
}

io.on('connection',socket=>{
  event(socket,'room:create',async()=>{
    const r=await store.createRoom();
    return r;
  });
  event(socket,'room:join',async({code,nickname})=>{
    const joined=await store.joinRoom(String(code || ''),nickname);
    await broadcast(joined.code);
    return joined;
  });
  event(socket,'room:subscribe',async({code,role,token,id})=>{
    code=String(code || '');
    const authorized=await store.authenticate(code,role,token,id);
    if(socket.data.code) {
      socket.leave(`room:${socket.data.code}`);
      if(socket.data.role==='admin')socket.leave(`admin:${socket.data.code}`);
      if(socket.data.role==='player')socket.leave(`player:${socket.data.code}:${socket.data.id}`);
    }
    socket.data.code=code;socket.data.role=authorized.role;socket.data.id=authorized.id || null;
    socket.join(`room:${code}`);
    if(role==='admin') socket.join(`admin:${code}`);
    else socket.join(`player:${code}:${authorized.id}`);
    const snapshot=await store.snapshot(code);
    const view=asView(snapshot);
    socket.emit('room:public',view.common);
    if(role==='admin')socket.emit('room:admin',{players:view.players});
    else {
      const own=view.players.find(p=>p.id===authorized.id);
      socket.emit('room:private',{id:own.id,nickname:own.nickname,active:own.active,metrics:own.metrics,decisions:own.decisions});
    }
    return {code,role};
  });
  event(socket,'room:decide',async({step,accepted})=>{
    if(socket.data.role!=='player')throw new UserError('Somente participantes podem decidir.');
    if(!Number.isInteger(step) || typeof accepted!=='boolean')throw new UserError('Escolha inválida.');
    await store.decide(socket.data.code,socket.data.id,step,accepted);
    await broadcast(socket.data.code);
    return {step,accepted};
  });
  event(socket,'room:admin-action',async({action,playerId})=>{
    if(socket.data.role!=='admin')throw new UserError('Somente o administrador pode fazer isso.');
    if(!['start','next','reveal','remove'].includes(action))throw new UserError('Ação desconhecida.');
    await store.adminAction(socket.data.code,action,playerId);
    await broadcast(socket.data.code);
    return {action};
  });
});

const port=Number(process.env.PORT || 3000);
httpServer.listen(port,'0.0.0.0',()=>console.log(`Simulador pronto: http://localhost:${port}`));
const stop=async()=>{io.close();httpServer.close();await store.close();process.exit(0);};
process.on('SIGTERM',stop);process.on('SIGINT',stop);
