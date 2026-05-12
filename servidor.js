// ============================================================
// IFFYWARE SYSTEMS — servidor.js (ACTUALIZADO)
// ============================================================
const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');

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
  negocios: [],
  usuarios: [],
  promos: [],
  contador: 1,
  negocio: 'Mi Negocio'
};

async function initDB() {
  if (!useDB) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS negocios (
      id SERIAL PRIMARY KEY,
      codigo TEXT UNIQUE NOT NULL,
      nombre TEXT NOT NULL,
      claveAcceso TEXT NOT NULL,
      latitud NUMERIC,
      longitud NUMERIC,
      direccion TEXT,
      telefonoLocal TEXT,
      activo BOOLEAN DEFAULT true,
      creadoEn TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      tipo TEXT,
      negocioId INTEGER REFERENCES negocios(id),
      clave TEXT,
      activo BOOLEAN DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT);
    
    CREATE TABLE IF NOT EXISTS productos (
      id BIGINT PRIMARY KEY,
      negocioId INTEGER,
      nombre TEXT,
      precio NUMERIC,
      categoria TEXT,
      descripcion TEXT,
      imagen TEXT
    );
    
    CREATE TABLE IF NOT EXISTS repartidores (
      id INTEGER PRIMARY KEY,
      negocioId INTEGER,
      nombre TEXT,
      dni TEXT,
      tel TEXT,
      com NUMERIC,
      foto TEXT,
      activo BOOLEAN DEFAULT true,
      lat NUMERIC,
      lng NUMERIC,
      registradoEn TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS pedidos (
      id INTEGER PRIMARY KEY,
      negocioId INTEGER,
      data JSONB
    );
    
    CREATE TABLE IF NOT EXISTS promos (
      id BIGINT PRIMARY KEY,
      negocioId INTEGER,
      data JSONB
    );

    CREATE TABLE IF NOT EXISTS mensajes (
      id SERIAL PRIMARY KEY,
      negocioId INTEGER,
      pedidoId INTEGER,
      de TEXT,
      deId INTEGER,
      para TEXT,
      paraId INTEGER,
      contenido TEXT,
      leido BOOLEAN DEFAULT false,
      creadoEn TIMESTAMP DEFAULT NOW()
    );
  `);

  // Agregar columnas si no existen
  await pool.query('ALTER TABLE productos ADD COLUMN IF NOT EXISTS imagen TEXT').catch(() => {});
  await pool.query('ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS dni TEXT').catch(() => {});
  await pool.query('ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS foto TEXT').catch(() => {});
  await pool.query('ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS lat NUMERIC').catch(() => {});
  await pool.query('ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS lng NUMERIC').catch(() => {});
  await pool.query('ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS negocioId INTEGER').catch(() => {});
  await pool.query('ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS registradoEn TIMESTAMP').catch(() => {});
  await pool.query('ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS negocioId INTEGER').catch(() => {});
  await pool.query('ALTER TABLE productos ADD COLUMN IF NOT EXISTS negocioId INTEGER').catch(() => {});

  const c = await pool.query('SELECT COUNT(*) FROM productos');
  if (parseInt(c.rows[0].count) === 0) {
    for (const p of ram.productos)
      await pool.query('INSERT INTO productos VALUES($1,null,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
        [p.id, p.nombre, p.precio, p.categoria, p.descripcion, p.imagen]);
  }
  console.log('Base de datos lista.');
}

async function getDB() {
  if (!useDB) return { ...ram, pedidos: [...ram.pedidos] };
  const [pr, re, pe, pm] = await Promise.all([
    pool.query('SELECT * FROM productos ORDER BY id'),
    pool.query('SELECT * FROM repartidores ORDER BY id'),
    pool.query('SELECT id,data FROM pedidos ORDER BY id DESC'),
    pool.query('SELECT data FROM promos')
  ]);
  return {
    negocio: ram.negocio || 'Mi Negocio',
    contador: ram.contador || 1,
    productos: pr.rows.map(r => ({ id:Number(r.id), nombre:r.nombre, precio:Number(r.precio), categoria:r.categoria, descripcion:r.descripcion||'', imagen:r.imagen||null })),
    repartidores: re.rows.map(r => ({ id:Number(r.id), nombre:r.nombre, dni:r.dni||'', tel:r.tel, com:Number(r.com), foto:r.foto||null, activo:r.activo!==false, lat:r.lat?Number(r.lat):null, lng:r.lng?Number(r.lng):null })),
    pedidos: pe.rows.map(r => ({ ...r.data, id:r.id })),
    promos: pm.rows.map(r => r.data)
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
});

function bcastLight(msg) {
  const t = JSON.stringify(msg);
  C.forEach(w => { if (w.readyState === WebSocket.OPEN) try { w.send(t); } catch(e) { C.delete(w); } });
}
async function bcast(tipo, extra) {
  const db = await getDB();
  bcastLight({ tipo, ...extra, db });
}

// ── AUTENTICACIÓN LOCAL ───────────────────────────────────────
app.post('/api/local/crear', async (q, r) => {
  try {
    const { nombreNegocio, claveInicial } = q.body;
    if (!nombreNegocio || !claveInicial) 
      return r.status(400).json({ error: 'Datos incompletos' });
    
    if (useDB) {
      // Generar código único
      let codigo;
      let existe = true;
      while (existe) {
        codigo = 'LOC' + Math.random().toString(36).substr(2, 6).toUpperCase();
        const check = await pool.query('SELECT id FROM negocios WHERE codigo=$1', [codigo]);
        existe = check.rows.length > 0;
      }
      
      // Crear negocio
      const negRes = await pool.query(
        `INSERT INTO negocios(codigo, nombre, claveAcceso, activo) 
         VALUES($1, $2, $3, true) RETURNING id, codigo`,
        [codigo, nombreNegocio, claveInicial]
      );
      
      r.json({ ok: true, negocio: { id: negRes.rows[0].id, codigo: negRes.rows[0].codigo, nombre: nombreNegocio } });
    } else {
      const codigo = 'TEST' + Math.random().toString(36).substr(2, 6).toUpperCase();
      ram.negocio = nombreNegocio;
      ram.negocioId = codigo;
      ram.claveLocal = claveInicial;
      r.json({ ok: true, negocio: { codigo, nombre: nombreNegocio } });
    }
  } catch(e) { console.error(e); r.status(500).json({ error: e.message }); }
});

app.post('/api/local/login', async (q, r) => {
  try {
    const { codigo, clave } = q.body;
    if (!codigo || !clave) return r.status(400).json({ error: 'Código y clave requeridos' });
    
    if (useDB) {
      const res = await pool.query(
        'SELECT id, nombre, codigo FROM negocios WHERE codigo=$1 AND claveAcceso=$2 AND activo=true',
        [codigo.toUpperCase(), clave]
      );
      if (!res.rows.length) return r.status(401).json({ error: 'Código o clave incorrectos' });
      
      const negocio = res.rows[0];
      const sessionId = 'LOCAL_' + negocio.id + '_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      
      r.json({ ok: true, sessionId, negocio: { id: negocio.id, codigo: negocio.codigo, nombre: negocio.nombre } });
    } else {
      if (codigo === ram.negocioId && clave === ram.claveLocal) {
        const sessionId = 'LOCAL_' + Date.now();
        r.json({ ok: true, sessionId, negocio: { codigo, nombre: ram.negocio } });
      } else {
        r.status(401).json({ error: 'Código o clave incorrectos' });
      }
    }
  } catch(e) { console.error(e); r.status(500).json({ error: e.message }); }
});

// ── API ───────────────────────────────────────────────────────
app.get('/api/db', async (q, r) => r.json(await getDB()));

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
      p = {
        ...q.body,
        id,
        fecha: new Date().toISOString(),
        estado: 'pendiente',
        hist: [{
          e:'pendiente',
          h:new Date().toLocaleTimeString()
        }]
      };
      ram.pedidos.unshift(p);
    }
    bcastLight({ tipo: 'PEDIDO_NUEVO', pedido: p });
    r.json({ ok: true, pedido: p });
  } catch(e) { console.error(e); r.status(500).json({ error: e.message }); }
});

app.put('/api/pedidos/:id/estado', async (q, r) => {
  try {
    const id = parseInt(q.params.id);
    const { estado, cobro, horaEntrega, efectivoRecibido } = q.body;
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
    if (efectivoRecibido !== undefined) p.efectivoRecibido = efectivoRecibido;
    if (estado === 'entregado') p.pagado = true;
    p.hist = p.hist || [];
    p.hist.push({ e: estado, h: new Date().toLocaleTimeString() });
    if (useDB) await pool.query('UPDATE pedidos SET data=$1 WHERE id=$2', [JSON.stringify(p), id]);
    bcastLight({ tipo: 'PEDIDO_ACTUALIZADO', pedido: p });
    r.json({ ok: true, pedido: p });
  } catch(e) { console.error(e); r.status(500).json({ error: e.message }); }
});

// ASIGNAR REPARTIDOR AL PEDIDO
app.put('/api/pedidos/:id/asignar-rep', async (q, r) => {
  try {
    const id = parseInt(q.params.id);
    const { repId } = q.body;
    
    let p;
    if (useDB) {
      const res = await pool.query('SELECT data FROM pedidos WHERE id=$1', [id]);
      if (!res.rows.length) return r.status(404).json({ error: 'Pedido no encontrado' });
      p = { ...res.rows[0].data, id };
    } else {
      p = ram.pedidos.find(x => x.id === id);
      if (!p) return r.status(404).json({ error: 'Pedido no encontrado' });
    }

    const rep = ram.repartidores.find(r => r.id == repId);
    if (!rep) return r.status(400).json({ error: 'Repartidor no existe' });

    p.repId = repId;
    p.repNombre = rep.nombre;
    p.repAsignadoEn = new Date().toISOString();

    if (useDB) {
      await pool.query('UPDATE pedidos SET data=$1 WHERE id=$2', [JSON.stringify(p), id]);
    }

    bcastLight({ 
      tipo: 'PEDIDO_ASIGNADO_AL_REP', 
      pedido: p,
      repId: repId 
    });

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
    const { nombre, dni, tel, com, foto } = q.body;
    let newId;
    if (useDB) {
      const res = await pool.query('SELECT MAX(id) as mx FROM repartidores');
      const mx = res.rows[0]?.mx || 999;
      newId = Math.max(parseInt(mx) + 1, 1000);
      if (newId > 9999) newId = parseInt(mx) + 1;
      await pool.query(
        'INSERT INTO repartidores(id,nombre,dni,tel,com,foto,activo,registradoEn) VALUES($1,$2,$3,$4,$5,$6,true,NOW()) ON CONFLICT(id) DO UPDATE SET nombre=$2,dni=$3,tel=$4,com=$5,foto=$6',
        [newId, nombre, dni||'', tel||'', com||0, foto||null]
      );
    } else {
      const mx = ram.repartidores.reduce((m,r) => Math.max(m, r.id||0), 999);
      newId = Math.max(mx + 1, 1000);
      ram.repartidores.push({ id:newId, nombre, dni:dni||'', tel:tel||'', com:com||0, foto:foto||null, activo:true, lat:null, lng:null, registradoEn:new Date().toISOString() });
    }
    await bcast('DATOS_ACTUALIZADOS', {});
    r.json({ ok: true, rep: { id:newId, nombre, dni, tel, com, foto } });
  } catch(e) { console.error(e); r.status(500).json({ error: e.message }); }
});

// VERIFICAR REPARTIDOR EN LOCAL
app.post('/api/rep/verificar', async (q, r) => {
  try {
    const { repId } = q.body;
    
    if (useDB) {
      const res = await pool.query(
        'SELECT id,nombre FROM repartidores WHERE id=$1 AND activo=true',
        [repId]
      );
      if (!res.rows.length) {
        return r.status(401).json({ 
          error: 'Este repartidor no está registrado en este local' 
        });
      }
      r.json({ ok: true, rep: res.rows[0] });
    } else {
      const rep = ram.repartidores.find(r => r.id === repId && r.activo);
      if (!rep) {
        return r.status(401).json({ 
          error: 'Este repartidor no está registrado en este local' 
        });
      }
      r.json({ ok: true, rep });
    }
  } catch(e) { r.status(500).json({ error: e.message }); }
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
    if (useDB) await pool.query('INSERT INTO productos VALUES($1,null,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET nombre=$2,precio=$3,categoria=$4,descripcion=$5,imagen=$6',
      [id, nombre, precio, categoria||'principal', descripcion||'', imagen||null]);
    else ram.productos.push({ id, nombre, precio, categoria:categoria||'principal', descripcion:descripcion||'', imagen:imagen||null });
    await bcast('DATOS_ACTUALIZADOS', {});
    r.json({ ok: true });
  } catch(e) { console.error(e); r.status(500).json({ error: e.message }); }
});

app.put('/api/productos/:id', async (q, r) => {
  try {
    const id = parseInt(q.params.id);
    const { nombre, precio, categoria, descripcion, imagen } = q.body;
    if (useDB) await pool.query('UPDATE productos SET nombre=$2,precio=$3,categoria=$4,descripcion=$5,imagen=$6 WHERE id=$1',
      [id, nombre, precio, categoria||'principal', descripcion||'', imagen||null]);
    else {
      const p = ram.productos.find(x => x.id === id);
      if (p) { p.nombre=nombre; p.precio=precio; p.categoria=categoria; p.descripcion=descripcion||''; p.imagen=imagen||null; }
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
    if (q.body.negocio) {
      if (useDB) await pool.query("UPDATE config SET value=$1 WHERE key='negocio'", [q.body.negocio]);
      else ram.negocio = q.body.negocio;
    }
    if (q.body.promos) {
      if (useDB) {
        await pool.query('DELETE FROM promos');
        for (const p of q.body.promos)
          await pool.query('INSERT INTO promos VALUES($1,null,$2)', [Date.now() + Math.random(), JSON.stringify(p)]);
      } else ram.promos = q.body.promos;
    }
    await bcast('DATOS_ACTUALIZADOS', {});
    r.json({ ok: true });
  } catch(e) { console.error(e); r.status(500).json({ error: e.message }); }
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
  });
}
main();
