// ============================================================
// IFFYWARE SYSTEMS — servidor.js
// ============================================================
const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');
const crypto    = require('crypto');

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });

app.use(express.json({ limit: '10mb' }));
app.use((q, r, n) => {
  r.header('Access-Control-Allow-Origin', '*');
  r.header('Access-Control-Allow-Headers', 'Content-Type');
  r.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (q.method === 'OPTIONS') return r.sendStatus(200);
  n();
});

// HTML en la raiz del proyecto
app.use(express.static(path.join(__dirname)));
app.get('*', (q, r) => r.sendFile(path.join(__dirname, 'pvdelivery.html')));

// ── Base de datos ─────────────────────────────────────────────
let useDB = false;
let pool  = null;

if (process.env.DATABASE_URL) {
  try {
    const { Pool } = require('pg');
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      max: 3,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000
    });
    useDB = true;
    console.log('Usando PostgreSQL');
  } catch(e) {
    console.log('pg no disponible, usando RAM');
  }
} else {
  console.log('Sin DATABASE_URL — modo RAM');
}

// ── Datos en RAM ──────────────────────────────────────────────
// Generar código único de local si no existe
function generarCodigoLocal() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

let ram = {
  pedidos: [],
  productos: [
    { id:1, nombre:'Hamburguesa',  precio:3000, categoria:'principal',      descripcion:'', imagen:null },
    { id:2, nombre:'Pizza',        precio:5000, categoria:'principal',      descripcion:'', imagen:null },
    { id:3, nombre:'Empanadas',    precio:1500, categoria:'principal',      descripcion:'', imagen:null },
    { id:4, nombre:'Arepa',        precio:2500, categoria:'principal',      descripcion:'', imagen:null },
    { id:5, nombre:'Coca Cola',    precio: 800, categoria:'bebida',         descripcion:'', imagen:null },
    { id:6, nombre:'Papas fritas', precio:1200, categoria:'acompanamiento', descripcion:'', imagen:null }
  ],
  repartidores: [],
  clientes: [],
  promos: [],
  pagosSimulados: [],
  contador: 1,
  negocio: 'Mi Negocio',
  codigoLocal: generarCodigoLocal(),
  dirLocal: '',
  cbuLocal: '',
  aliasLocal: '',
  comisionTipo: 'por_km',
  comisionPorMetro: 0.60,
  comisionFija: 0
};

async function initDB() {
  if (!useDB) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS config      (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS productos   (id BIGINT PRIMARY KEY, nombre TEXT, precio NUMERIC, categoria TEXT, descripcion TEXT, imagen TEXT);
    CREATE TABLE IF NOT EXISTS repartidores(id INTEGER PRIMARY KEY, nombre TEXT, dni TEXT, tel TEXT, com NUMERIC, foto TEXT, activo BOOLEAN DEFAULT true, alias TEXT DEFAULT '');
    CREATE TABLE IF NOT EXISTS pedidos     (id INTEGER PRIMARY KEY, data JSONB);
    CREATE TABLE IF NOT EXISTS promos      (id BIGINT PRIMARY KEY, data JSONB);
    CREATE TABLE IF NOT EXISTS clientes    (id BIGINT PRIMARY KEY, data JSONB);
    CREATE TABLE IF NOT EXISTS pagos_sim   (id BIGINT PRIMARY KEY, data JSONB);
  `);
  await pool.query('ALTER TABLE productos ADD COLUMN IF NOT EXISTS imagen TEXT').catch(() => {});
  await pool.query('ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS dni TEXT').catch(() => {});
  await pool.query('ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS foto TEXT').catch(() => {});
  await pool.query('ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT true').catch(() => {});
  await pool.query('ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS lat NUMERIC').catch(() => {});
  await pool.query('ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS lng NUMERIC').catch(() => {});

  const codigo = generarCodigoLocal();
  await pool.query(`INSERT INTO config(key,value) VALUES('negocio','Mi Negocio'),('contador','1'),('codigoLocal','${codigo}'),('dirLocal',''),('comisionTipo','por_km'),('comisionPorMetro','0.60'),('comisionFija','0') ON CONFLICT(key) DO NOTHING`);

  const c = await pool.query('SELECT COUNT(*) FROM productos');
  if (parseInt(c.rows[0].count) === 0) {
    for (const p of ram.productos)
      await pool.query('INSERT INTO productos VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
        [p.id, p.nombre, p.precio, p.categoria, p.descripcion, p.imagen]);
  }
  console.log('Base de datos lista.');
}

async function getDB() {
  if (!useDB) return {
    ...ram,
    pedidos: [...ram.pedidos],
    cbuLocal: ram.cbuLocal||'',
    aliasLocal: ram.aliasLocal||'',
    clientes: [...(ram.clientes||[])],
    pagosSimulados: [...(ram.pagosSimulados||[])],
    comisionTipo: ram.comisionTipo||'por_km',
    comisionPorMetro: ram.comisionPorMetro||0.60,
    comisionFija: ram.comisionFija||0
  };
  const [cfg, pr, re, pe, pm, cl, pg] = await Promise.all([
    pool.query('SELECT key,value FROM config'),
    pool.query('SELECT * FROM productos ORDER BY id'),
    pool.query('SELECT * FROM repartidores ORDER BY id'),
    pool.query('SELECT id,data FROM pedidos ORDER BY id DESC'),
    pool.query('SELECT data FROM promos'),
    pool.query('SELECT data FROM clientes ORDER BY id DESC').catch(()=>({rows:[]})),
    pool.query('SELECT data FROM pagos_sim ORDER BY id DESC LIMIT 50').catch(()=>({rows:[]}))
  ]);
  const config = {};
  cfg.rows.forEach(r => config[r.key] = r.value);
  return {
    negocio:        config.negocio || 'Mi Negocio',
    contador:       parseInt(config.contador || '1'),
    codigoLocal:    config.codigoLocal || '',
    dirLocal:       config.dirLocal || '',
    cbuLocal:       config.cbuLocal || '',
    aliasLocal:     config.aliasLocal || '',
    comisionTipo:   config.comisionTipo || 'por_km',
    comisionPorMetro: parseFloat(config.comisionPorMetro||'0.60'),
    comisionFija:   parseFloat(config.comisionFija||'0'),
    productos:      pr.rows.map(r => ({ id:Number(r.id), nombre:r.nombre, precio:Number(r.precio), categoria:r.categoria, descripcion:r.descripcion||'', imagen:r.imagen||null, agotado:r.agotado||false })),
    repartidores:   re.rows.map(r => ({ id:Number(r.id), nombre:r.nombre, dni:r.dni||'', tel:r.tel, com:Number(r.com), foto:r.foto||null, activo:r.activo!==false, lat:r.lat?Number(r.lat):null, lng:r.lng?Number(r.lng):null })),
    pedidos:        pe.rows.map(r => ({ ...r.data, id:r.id })),
    promos:         pm.rows.map(r => r.data),
    clientes:       cl.rows.map(r => r.data),
    pagosSimulados: pg.rows.map(r => r.data)
  };
}

// ── WebSockets ────────────────────────────────────────────────
const C = new Set();
const PING = setInterval(() => {
  C.forEach(ws => {
    if (ws.isAlive === false) { C.delete(ws); return ws.terminate(); }
    ws.isAlive = false;
    ws.ping();
  });
}, 30000);
wss.on('close', () => clearInterval(PING));

wss.on('connection', async ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  C.add(ws);
  console.log('Conectado. Total: ' + C.size);
  try {
    const db = await getDB();
    ws.send(JSON.stringify({ tipo: 'ESTADO_INICIAL', db }));
  } catch(e) { console.error('WS error:', e.message); }
  ws.on('close', () => C.delete(ws));
  ws.on('error', () => { C.delete(ws); ws.terminate(); });
  ws.on('message', data => {
    try {
      const msg = JSON.parse(data);
      // Reenviar mensajes de chat a todos los conectados
      if (msg.tipo === 'CHAT_MSG') {
        const t = JSON.stringify(msg);
        C.forEach(w => { if (w !== ws && w.readyState === WebSocket.OPEN) try { w.send(t); } catch(e){} });
      }
    } catch(e) {}
  });
});

function bcastLight(msg) {
  const t = JSON.stringify(msg);
  C.forEach(w => { if (w.readyState === WebSocket.OPEN) try { w.send(t); } catch(e) { C.delete(w); } });
}
async function bcast(tipo, extra) {
  const db = await getDB();
  bcastLight({ tipo, ...extra, db });
}

// ── API ───────────────────────────────────────────────────────
app.get('/api/db', async (q, r) => r.json(await getDB()));

// Verificar repartidor por ID (para login antes de conectar WS)
app.get('/api/repartidores/:id/verificar', async (q, r) => {
  try {
    const id = parseInt(q.params.id);
    let rep = null;
    if (useDB) {
      const res = await pool.query('SELECT * FROM repartidores WHERE id=$1', [id]);
      if (res.rows.length) {
        const row = res.rows[0];
        rep = { id:Number(row.id), nombre:row.nombre, dni:row.dni||'', tel:row.tel, com:Number(row.com), foto:row.foto||null, activo:row.activo!==false };
      }
    } else {
      rep = ram.repartidores.find(x => x.id === id) || null;
    }
    if (!rep) return r.status(200).json({ ok: false, error: 'ID no encontrado' });
    if (rep.activo === false) return r.status(200).json({ ok: false, error: 'Repartidor inactivo' });
    r.status(200).json({ ok: true, rep });
  } catch(e) { r.status(500).json({ error: e.message }); }
});

app.post('/api/pedidos', async (q, r) => {
  try {
    let id, p;
    if (useDB) {
      const cRes = await pool.query("SELECT value FROM config WHERE key='contador'");
      id = parseInt(cRes.rows[0]?.value || '1');
      p = { ...q.body, id, fecha: new Date().toISOString(), estado: 'pendiente', hist: [{ e:'pendiente', h:new Date().toLocaleTimeString() }] };
      await pool.query('INSERT INTO pedidos(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2', [id, JSON.stringify(p)]);
      await pool.query("UPDATE config SET value=$1 WHERE key='contador'", [String(id + 1)]);
    } else {
      id = ram.contador++;
      p = { ...q.body, id, fecha: new Date().toISOString(), estado: 'pendiente', hist: [{ e:'pendiente', h:new Date().toLocaleTimeString() }] };
      ram.pedidos.unshift(p);
    }
    bcastLight({ tipo: 'PEDIDO_NUEVO', pedido: p });
    r.json({ ok: true, pedido: p });
  } catch(e) { console.error(e); r.status(500).json({ error: e.message }); }
});

app.put('/api/pedidos/:id/estado', async (q, r) => {
  try {
    const id = parseInt(q.params.id);
    const { estado, cobro, horaEntrega, repId, repNombre } = q.body;
    let p;
    if (useDB) {
      const res = await pool.query('SELECT data FROM pedidos WHERE id=$1', [id]);
      if (!res.rows.length) return r.status(404).json({ error: 'No encontrado' });
      p = { ...res.rows[0].data, id };
    } else {
      p = ram.pedidos.find(x => x.id === id);
      if (!p) return r.status(404).json({ error: 'No encontrado' });
    }
    p.estado = estado;
    if (cobro) p.cobro = cobro;
    if (horaEntrega) p.horaEntrega = horaEntrega;
    if (repId !== undefined) { p.repId = repId; p.repNombre = repNombre || null; }
    if (estado === 'entregado') p.pagado = true;
    if (q.body.pagado !== undefined) p.pagado = q.body.pagado;
    if (q.body.pagadoPor) p.pagadoPor = q.body.pagadoPor;
    if (q.body.pagadoEn) p.pagadoEn = q.body.pagadoEn;
    if (q.body.pagoRechazado) p.pagoRechazado = q.body.pagoRechazado;
    if (q.body.listoRetiro !== undefined) p.listoRetiro = q.body.listoRetiro;
    if (q.body.kmRecorridos !== undefined) p.kmRecorridos = q.body.kmRecorridos;
    if (q.body.comisionKm !== undefined) p.comisionKm = q.body.comisionKm;
    if (q.body.kmEstimado !== undefined) p.kmEstimado = q.body.kmEstimado;
    if (q.body.devolucion !== undefined) p.devolucion = q.body.devolucion;
    p.hist = p.hist || [];
    p.hist.push({ e: estado, h: new Date().toLocaleTimeString() });
    if (useDB) await pool.query('UPDATE pedidos SET data=$1 WHERE id=$2', [JSON.stringify(p), id]);
    bcastLight({ tipo: 'PEDIDO_ACTUALIZADO', pedido: p });
    r.json({ ok: true, pedido: p });
  } catch(e) { console.error(e); r.status(500).json({ error: e.message }); }
});

app.delete('/api/pedidos', async (q, r) => {
  try {
    if (useDB) { await pool.query('DELETE FROM pedidos'); await pool.query("UPDATE config SET value='1' WHERE key='contador'"); }
    else { ram.pedidos = []; ram.contador = 1; }
    await bcast('ESTADO_INICIAL', {});
    r.json({ ok: true });
  } catch(e) { r.status(500).json({ error: e.message }); }
});

app.post('/api/repartidores', async (q, r) => {
  try {
    const { nombre, dni, tel, com, foto, vehiculo, alias } = q.body;
    let newId;
    if (useDB) {
      const res = await pool.query('SELECT MAX(id) as mx FROM repartidores');
      const mx = res.rows[0]?.mx || 999;
      newId = Math.max(parseInt(mx) + 1, 1000);
      if (newId > 9999) newId = parseInt(mx) + 1;
      await pool.query('ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS vehiculo TEXT').catch(()=>{});
      await pool.query(
        'INSERT INTO repartidores(id,nombre,dni,tel,com,foto,activo,vehiculo) VALUES($1,$2,$3,$4,$5,$6,true,$7) ON CONFLICT(id) DO UPDATE SET nombre=$2,dni=$3,tel=$4,com=$5,foto=$6,vehiculo=$7',
        [newId, nombre, dni||'', tel||'', com||0, foto||null, vehiculo||'moto']
      );
    } else {
      const mx = ram.repartidores.reduce((m,r) => Math.max(m, r.id||0), 999);
      newId = Math.max(mx + 1, 1000);
      ram.repartidores.push({ id:newId, nombre, dni:dni||'', tel:tel||'', com:com||0, foto:foto||null, activo:true, vehiculo:vehiculo||'moto', lat:null, lng:null });
    }
    await bcast('DATOS_ACTUALIZADOS', {});
    r.json({ ok: true, rep: { id:newId, nombre, dni, tel, com, foto } });
  } catch(e) { console.error(e); r.status(500).json({ error: e.message }); }
});

app.delete('/api/repartidores/:id', async (q, r) => {
  try {
    const id = parseInt(q.params.id);
    if (useDB) await pool.query('DELETE FROM repartidores WHERE id=$1', [id]);
    else ram.repartidores = ram.repartidores.filter(x => x.id !== id);
    await bcast('DATOS_ACTUALIZADOS', {});
    r.json({ ok: true });
  } catch(e) { r.status(500).json({ error: e.message }); }
});

app.put('/api/repartidores/:id', async (q, r) => {
  try {
    const id = parseInt(q.params.id);
    const { nombre, dni, tel, com, foto, vehiculo, activo, alias } = q.body;
    if (useDB) {
      await pool.query('UPDATE repartidores SET nombre=$2,dni=$3,tel=$4,com=$5,foto=$6,activo=$7 WHERE id=$1',
        [id, nombre, dni||'', tel||'', com||0, foto||null, activo !== false]);
      // Agregar columna vehiculo si no existe
      await pool.query('ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS vehiculo TEXT').catch(()=>{});
      await pool.query('UPDATE repartidores SET vehiculo=$1 WHERE id=$2', [vehiculo||'moto', id]);
    } else {
      const rep = ram.repartidores.find(x => x.id === id);
      if (rep) { rep.nombre=nombre; rep.dni=dni||''; rep.tel=tel||''; rep.com=com||0; rep.activo=activo!==false; rep.vehiculo=vehiculo||'moto'; if(foto!==undefined) rep.foto=foto; }
    }
    await bcast('DATOS_ACTUALIZADOS', {});
    r.json({ ok: true });
  } catch(e) { console.error(e); r.status(500).json({ error: e.message }); }
});

app.put('/api/repartidores/:id/ubicacion', async (q, r) => {
  try {
    const id = parseInt(q.params.id);
    const { lat, lng } = q.body;
    if (useDB) {
      await pool.query('UPDATE repartidores SET lat=$1,lng=$2 WHERE id=$3', [lat, lng, id]);
    } else {
      const rep = ram.repartidores.find(x => x.id === id);
      if (rep) { rep.lat = lat; rep.lng = lng; }
    }
    bcastLight({ tipo: 'UBICACION_REP', repId: id, lat, lng });
    r.json({ ok: true });
  } catch(e) { r.status(500).json({ error: e.message }); }
});

app.post('/api/productos', async (q, r) => {
  try {
    const { nombre, precio, categoria, descripcion, imagen } = q.body;
    const id = Date.now();
    if (useDB) await pool.query('INSERT INTO productos VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET nombre=$2,precio=$3,categoria=$4,descripcion=$5,imagen=$6',
      [id, nombre, precio, categoria||'principal', descripcion||'', imagen||null]);
    else ram.productos.push({ id, nombre, precio, categoria:categoria||'principal', descripcion:descripcion||'', imagen:imagen||null });
    await bcast('DATOS_ACTUALIZADOS', {});
    r.json({ ok: true });
  } catch(e) { console.error(e); r.status(500).json({ error: e.message }); }
});

app.put('/api/productos/:id', async (q, r) => {
  try {
    const id = parseInt(q.params.id);
    const { nombre, precio, categoria, descripcion, imagen, agotado } = q.body;
    if (useDB) {
      await pool.query('ALTER TABLE productos ADD COLUMN IF NOT EXISTS agotado BOOLEAN DEFAULT false').catch(()=>{});
      await pool.query('UPDATE productos SET nombre=$2,precio=$3,categoria=$4,descripcion=$5,imagen=$6,agotado=$7 WHERE id=$1',
        [id, nombre, precio, categoria||'principal', descripcion||'', imagen||null, agotado||false]);
    } else {
      const p = ram.productos.find(x => x.id === id);
      if (p) { p.nombre=nombre; p.precio=precio; p.categoria=categoria; p.descripcion=descripcion||''; if(imagen!==undefined)p.imagen=imagen; p.agotado=agotado||false; }
    }
    await bcast('DATOS_ACTUALIZADOS', {});
    r.json({ ok: true });
  } catch(e) { console.error(e); r.status(500).json({ error: e.message }); }
});

app.delete('/api/productos/:id', async (q, r) => {
  try {
    const id = parseInt(q.params.id);
    if (useDB) await pool.query('DELETE FROM productos WHERE id=$1', [id]);
    else ram.productos = ram.productos.filter(x => x.id !== id);
    await bcast('DATOS_ACTUALIZADOS', {});
    r.json({ ok: true });
  } catch(e) { r.status(500).json({ error: e.message }); }
});

app.put('/api/config', async (q, r) => {
  try {
    if (q.body.negocio !== undefined) {
      if (useDB) await pool.query("UPDATE config SET value=$1 WHERE key='negocio'", [q.body.negocio]);
      else ram.negocio = q.body.negocio;
    }
    if (q.body.dirLocal !== undefined) {
      if (useDB) await pool.query("INSERT INTO config(key,value) VALUES('dirLocal',$1) ON CONFLICT(key) DO UPDATE SET value=$1", [q.body.dirLocal]);
      else ram.dirLocal = q.body.dirLocal;
    }
    if (q.body.cbuLocal !== undefined) {
      if (useDB) await pool.query("INSERT INTO config(key,value) VALUES('cbuLocal',$1) ON CONFLICT(key) DO UPDATE SET value=$1", [q.body.cbuLocal]);
      else ram.cbuLocal = q.body.cbuLocal;
    }
    if (q.body.aliasLocal !== undefined) {
      if (useDB) await pool.query("INSERT INTO config(key,value) VALUES('aliasLocal',$1) ON CONFLICT(key) DO UPDATE SET value=$1", [q.body.aliasLocal]);
      else ram.aliasLocal = q.body.aliasLocal;
    }
    if (q.body.comisionTipo !== undefined) {
      if (useDB) await pool.query("INSERT INTO config(key,value) VALUES('comisionTipo',$1) ON CONFLICT(key) DO UPDATE SET value=$1", [q.body.comisionTipo]);
      else ram.comisionTipo = q.body.comisionTipo;
    }
    if (q.body.comisionPorMetro !== undefined) {
      const v = String(q.body.comisionPorMetro);
      if (useDB) await pool.query("INSERT INTO config(key,value) VALUES('comisionPorMetro',$1) ON CONFLICT(key) DO UPDATE SET value=$1", [v]);
      else ram.comisionPorMetro = parseFloat(v);
    }
    if (q.body.comisionFija !== undefined) {
      const v = String(q.body.comisionFija);
      if (useDB) await pool.query("INSERT INTO config(key,value) VALUES('comisionFija',$1) ON CONFLICT(key) DO UPDATE SET value=$1", [v]);
      else ram.comisionFija = parseFloat(v);
    }
    if (q.body.promos) {
      if (useDB) {
        await pool.query('DELETE FROM promos');
        for (const p of q.body.promos)
          await pool.query('INSERT INTO promos VALUES($1,$2)', [Date.now() + Math.random(), JSON.stringify(p)]);
      } else ram.promos = q.body.promos;
    }
    await bcast('DATOS_ACTUALIZADOS', {});
    r.json({ ok: true });
  } catch(e) { console.error(e); r.status(500).json({ error: e.message }); }
});

// ── CLIENTES ──────────────────────────────────────────────
app.post('/api/clientes', async (q, r) => {
  try {
    const { id, nombre, tel, dir } = q.body;
    const cliId = id || Date.now();
    const data = { id: cliId, nombre, tel, dir, fechaReg: new Date().toISOString() };
    if (useDB) {
      await pool.query('INSERT INTO clientes(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2', [cliId, JSON.stringify(data)]);
    } else {
      const idx = ram.clientes.findIndex(c => c.id == cliId);
      if (idx >= 0) ram.clientes[idx] = data; else ram.clientes.push(data);
    }
    r.json({ ok: true, cliente: data });
  } catch(e) { r.status(500).json({ error: e.message }); }
});

app.get('/api/clientes', async (q, r) => {
  try {
    if (useDB) {
      const res = await pool.query('SELECT data FROM clientes ORDER BY id DESC');
      r.json(res.rows.map(x => x.data));
    } else {
      r.json(ram.clientes || []);
    }
  } catch(e) { r.status(500).json({ error: e.message }); }
});

// ── PAGOS SIMULADOS ───────────────────────────────────────
// Simula movimientos bancarios para transferencia/tarjeta
app.post('/api/pagos/simular', async (q, r) => {
  try {
    const { pedidoId, monto, metodo, concepto } = q.body;
    const id = Date.now();
    const pago = {
      id, pedidoId, monto, metodo,
      concepto: concepto || 'Pago pedido #' + pedidoId,
      fecha: new Date().toISOString(),
      hora: new Date().toLocaleTimeString('es', {hour:'2-digit', minute:'2-digit', second:'2-digit'}),
      estado: 'acreditado',
      referencia: 'SIM-' + Math.random().toString(36).substr(2,8).toUpperCase()
    };
    if (useDB) {
      await pool.query('INSERT INTO pagos_sim(id,data) VALUES($1,$2)', [id, JSON.stringify(pago)]);
    } else {
      if (!ram.pagosSimulados) ram.pagosSimulados = [];
      ram.pagosSimulados.unshift(pago);
      if (ram.pagosSimulados.length > 100) ram.pagosSimulados = ram.pagosSimulados.slice(0,100);
    }
    bcastLight({ tipo: 'PAGO_NUEVO', pago });
    r.json({ ok: true, pago });
  } catch(e) { r.status(500).json({ error: e.message }); }
});

app.get('/api/pagos', async (q, r) => {
  try {
    if (useDB) {
      const res = await pool.query('SELECT data FROM pagos_sim ORDER BY id DESC LIMIT 50');
      r.json(res.rows.map(x => x.data));
    } else {
      r.json(ram.pagosSimulados || []);
    }
  } catch(e) { r.status(500).json({ error: e.message }); }
});

const PORT = process.env.PORT || 3000;
async function main() {
  if (useDB) {
    try { await initDB(); }
    catch(e) { console.error('Error DB, usando RAM:', e.message); useDB = false; pool = null; }
  }
  server.listen(PORT, () => {
    console.log('Iffyware Systems — ACTIVO en puerto ' + PORT);
    console.log('Modo: ' + (useDB ? 'PostgreSQL' : 'RAM'));
    if (!useDB) console.log('Código del local (RAM):', ram.codigoLocal);
  });
}
main();
