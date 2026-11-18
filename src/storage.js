import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { TRIPS } from './game.js';

export class UserError extends Error {
  constructor(message, code='INVALID') { super(message); this.name='UserError'; this.code=code; }
}
const hash = v => createHash('sha256').update(v).digest('hex');
const makeSecret = () => randomBytes(32).toString('base64url');
const sqlPg = sql => { let counter = 0; return sql.replace(/\?/g, () => `$${++counter}`); };

const DDL = [
  `CREATE TABLE IF NOT EXISTS rooms (
    code TEXT PRIMARY KEY, admin_hash TEXT NOT NULL, phase TEXT NOT NULL DEFAULT 'lobby',
    step INTEGER NOT NULL DEFAULT 0, created_at BIGINT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS players (
    id TEXT PRIMARY KEY, room_code TEXT NOT NULL REFERENCES rooms(code),
    nickname TEXT NOT NULL, nickname_key TEXT NOT NULL, secret_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1, joined_at BIGINT NOT NULL,
    UNIQUE(room_code, nickname_key)
  )`,
  `CREATE TABLE IF NOT EXISTS decisions (
    player_id TEXT NOT NULL REFERENCES players(id), step INTEGER NOT NULL,
    accepted INTEGER NOT NULL, created_at BIGINT NOT NULL,
    PRIMARY KEY(player_id, step)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_players_room ON players(room_code)`,
  `CREATE INDEX IF NOT EXISTS idx_decisions_player ON decisions(player_id)`
];

/** PostgreSQL in production, built-in SQLite for development and one-host workshops. */
export class Storage {
  constructor({ databaseUrl = process.env.DATABASE_URL || '', sqlitePath = process.env.SQLITE_PATH || './data/motoboy.sqlite', maxPlayers = Number(process.env.MAX_PLAYERS || 1000)} = {}) {
    this.databaseUrl = databaseUrl;
    this.sqlitePath = sqlitePath;
    this.maxPlayers = Math.min(5000,Math.max(1, maxPlayers));
    this.pool = null; this.sqlite = null; this.serial = Promise.resolve();
  }
  async init() {
    if (this.databaseUrl) {
      const { Pool } = await import('pg');
      this.pool = new Pool({connectionString:this.databaseUrl, max:Number(process.env.PG_POOL_SIZE || 20),
        ssl: process.env.PG_SSL === 'true' ? {rejectUnauthorized: process.env.PG_SSL_INSECURE !== 'true'} : undefined});
      for (const stmt of DDL) await this.pool.query(stmt);
    } else {
      if (this.sqlitePath !== ':memory:') mkdirSync(dirname(resolve(this.sqlitePath)),{recursive:true});
      this.sqlite = new DatabaseSync(this.sqlitePath);
      this.sqlite.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;');
      for (const stmt of DDL) this.sqlite.exec(stmt);
    }
  }
  async query(sql, args=[], cx=null) {
    if (this.pool) {
      const result = await (cx || this.pool).query(sqlPg(sql),args);
      return {rows:result.rows, rowCount:result.rowCount};
    }
    const stmt = this.sqlite.prepare(sql);
    if (/^\s*SELECT\b/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
      const rows = stmt.all(...args);
      return {rows, rowCount:rows.length};
    }
    const r = stmt.run(...args);
    return {rows:[],rowCount:r.changes};
  }
  async transaction(fn) {
    if (this.pool) {
      const cx = await this.pool.connect();
      try { await cx.query('BEGIN'); const result=await fn(cx); await cx.query('COMMIT'); return result; }
      catch(e) { await cx.query('ROLLBACK'); throw e; }
      finally { cx.release(); }
    }
    const task = this.serial.then(async () => {
      this.sqlite.exec('BEGIN IMMEDIATE');
      try { const v=await fn(null); this.sqlite.exec('COMMIT'); return v; }
      catch(e){ this.sqlite.exec('ROLLBACK'); throw e; }
    });
    this.serial = task.catch(()=>{});
    return task;
  }
  async findRoom(code, cx=null, lock=false) {
    const res = await this.query(`SELECT * FROM rooms WHERE code=?${lock && this.pool ? ' FOR UPDATE' : ''}`,[code],cx);
    return res.rows[0] || null;
  }
  async createRoom() {
    for(let tryNo=0;tryNo<15;tryNo++) {
      const code = String(randomInt(100000,1000000));
      const adminToken = makeSecret();
      try {
        await this.query('INSERT INTO rooms(code,admin_hash,phase,step,created_at) VALUES(?,?,?,?,?)',
          [code,hash(adminToken),'lobby',0,Date.now()]);
        return {code, adminToken};
      } catch(e){ if(/unique|duplicate/i.test(e.message)) continue; throw e; }
    }
    throw new Error('Não foi possível gerar um código único.');
  }
  async joinRoom(code, nickname) {
    const canonical = String(nickname || '').normalize('NFC').trim().replace(/\s+/g,' ');
    if(!/^\d{6}$/.test(String(code))) throw new UserError('Código inválido. Digite os seis números.');
    if(canonical.length < 2 || canonical.length > 24 || /[\p{C}]/u.test(canonical)) throw new UserError('Use um apelido com 2 a 24 caracteres.');
    const id = randomBytes(16).toString('hex'), playerToken = makeSecret();
    return this.transaction(async cx => {
      const r = await this.findRoom(code,cx,true);
      if(!r) throw new UserError('Sala não encontrada.');
      if(r.phase !== 'lobby') throw new UserError('Esta sala já começou.');
      const current = await this.query('SELECT COUNT(*) AS n FROM players WHERE room_code=? AND active=1',[code],cx);
      if(Number(current.rows[0].n)>=this.maxPlayers) throw new UserError('Esta sala atingiu o limite de participantes.');
      try {
        await this.query('INSERT INTO players(id,room_code,nickname,nickname_key,secret_hash,active,joined_at) VALUES(?,?,?,?,?,?,?)',
          [id,code,canonical,canonical.toLocaleLowerCase('pt-BR'),hash(playerToken),1,Date.now()],cx);
      } catch(e) {
        if(/unique|duplicate/i.test(e.message)) throw new UserError('Esse apelido já está em uso nesta sala.');
        throw e;
      }
      return {id, playerToken, code, nickname:canonical};
    });
  }
  async authenticate(code, role, credential, playerId=null) {
    const r = await this.findRoom(code);
    if(!r) throw new UserError('Sala não encontrada.');
    if(role==='admin' && hash(String(credential))===r.admin_hash) return {role,code};
    if(role==='player' && /^[0-9a-f]{32}$/.test(String(playerId))) {
      const result = await this.query('SELECT id,secret_hash,active FROM players WHERE id=? AND room_code=?',[playerId,code]);
      const p=result.rows[0];
      if(p && p.active && hash(String(credential))===p.secret_hash) return {role,code,id:p.id};
    }
    throw new UserError('Sessão inválida ou participante removido.');
  }
  async decide(code, playerId, step, accepted) {
    return this.transaction(async cx => {
      const r = await this.findRoom(code,cx,true);
      if(!r || r.phase !== 'playing' || r.step !== step || typeof accepted !== 'boolean')
        throw new UserError('A oferta já terminou ou a escolha é inválida.');
      if(step<0 || step>=TRIPS.length) throw new UserError('Rodada inválida.');
      const res = await this.query('SELECT active FROM players WHERE id=? AND room_code=?',[playerId,code],cx);
      if(!res.rows[0] || !res.rows[0].active) throw new UserError('Participante não está ativo.');
      const count = await this.query('SELECT COUNT(*) AS n FROM decisions WHERE player_id=?',[playerId],cx);
      if(Number(count.rows[0].n)!==step) throw new UserError('Essa corrida já foi respondida.');
      await this.query('INSERT INTO decisions(player_id,step,accepted,created_at) VALUES(?,?,?,?)',
        [playerId,step,accepted?1:0,Date.now()],cx);
      return {ok:true};
    });
  }
  async adminAction(code, action, playerId=null) {
    return this.transaction(async cx => {
      const r=await this.findRoom(code,cx,true);
      if(!r) throw new UserError('Sala não encontrada.');
      if(action==='remove') {
        if(r.phase==='results') throw new UserError('A apresentação já foi encerrada.');
        const updated=await this.query('UPDATE players SET active=0 WHERE room_code=? AND id=? AND active=1',[code,playerId],cx);
        if(!updated.rowCount) throw new UserError('Participante já removido.');
        return {ok:true};
      }
      const active = await this.query('SELECT COUNT(*) AS n FROM players WHERE room_code=? AND active=1',[code],cx);
      const total=Number(active.rows[0].n);
      if(action==='start') {
        if(r.phase!=='lobby' || total<1) throw new UserError('Entre com pelo menos um participante antes de começar.');
        await this.query("UPDATE rooms SET phase='playing',step=0 WHERE code=?",[code],cx);
      } else if(action==='next' || action==='reveal') {
        if(r.phase!=='playing' || !total) throw new UserError('Não há uma rodada em andamento.');
        if(action==='next' && r.step>=7) throw new UserError('Última corrida. Libere os resultados.');
        if(action==='reveal' && r.step!==7) throw new UserError('As oito corridas ainda não terminaram.');
        const answerCount=await this.query(`SELECT COUNT(*) AS n FROM decisions d
          JOIN players p ON p.id=d.player_id WHERE p.room_code=? AND p.active=1 AND d.step=?`,[code,r.step],cx);
        if(Number(answerCount.rows[0].n)!==total) throw new UserError('Aguarde as escolhas de todos ou remova um participante ausente.');
        if(action==='next') await this.query('UPDATE rooms SET step=? WHERE code=?',[r.step+1,code],cx);
        else await this.query("UPDATE rooms SET phase='results' WHERE code=?",[code],cx);
      } else throw new UserError('Ação desconhecida.');
      return {ok:true};
    });
  }
  async snapshot(code) {
    const room=await this.findRoom(code);
    if(!room)return null;
    const players=(await this.query('SELECT id,nickname,active,joined_at FROM players WHERE room_code=? ORDER BY joined_at,id',[code])).rows;
    const decisions=(await this.query(`SELECT d.player_id,d.step,d.accepted FROM decisions d JOIN players p ON p.id=d.player_id
      WHERE p.room_code=? ORDER BY d.step`,[code])).rows;
    const byPlayer=new Map(players.map(p=>[p.id,[]]));
    for(const d of decisions) byPlayer.get(d.player_id)?.push({step:Number(d.step),accepted:Number(d.accepted)});
    return {room:{code:room.code,phase:room.phase,step:Number(room.step)},players:players.map(p=>({id:p.id,nickname:p.nickname,active:Boolean(Number(p.active)),decisions:byPlayer.get(p.id) || []}))};
  }
  async close(){ if(this.pool) await this.pool.end(); else if(this.sqlite) this.sqlite.close(); }
}
