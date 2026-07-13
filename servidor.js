// ============================================================
// IFFYWARE SYSTEMS — PVDelivery servidor.js
// ============================================================
//
// ── VARIABLES DE ENTORNO (Railway / Render / .env) ──────────
//
//  BASE (obligatorio):
//    PORT              → asignado automáticamente por Railway
//    DATABASE_URL      → (opcional) PostgreSQL connection string
//                        sin esto, usa RAM (datos se pierden al reiniciar)
//
//  MERCADO PAGO SANDBOX (gratuito, sin dinero real):
//    MP_ACCESS_TOKEN   → Ej: TEST-1234567890-xxxxxxxx-...
//    MP_PUBLIC_KEY     → Ej: TEST-xxxxxxxx-xxxx-...
//    Cómo obtenerlos:
//      1. mercadopago.com.ar/developers → Crear aplicación (tipo: Checkout API)
//      2. Tus integraciones → tu app → Credenciales de PRUEBA
//      3. Copiar Access Token y Public Key (los que empiezan con TEST-)
//    Tarjetas de prueba sandbox Argentina:
//      Visa:       4509 9535 6623 3704 · CVV: 123 · Vto: 11/30
//      Mastercard: 5031 7557 3453 0604 · CVV: 123 · Vto: 11/30
//      Amex:       3711 803032 57522   · CVV: 1234 · Vto: 11/30
//      Titular APRO APRO → aprobado / FUND FUND → rechazado
//
//  MODO (requiere onboarding comercial en modo.com.ar/empresas):
//    MODO_CLIENT_ID     → otorgado por MODO después del registro
//    MODO_CLIENT_SECRET → otorgado por MODO después del registro
//    Sin API sandbox pública — pruebas en producción con cuentas de test MODO
//
//  PERSONAL PAY / UALA / NARANJA X / BNA+:
//    No requieren variables — pagan por QR/CBU interoperable BCRA (Transferencia 3.0)
//    Configurar CBU/Alias en Config del sistema, el cliente ve los datos al pagar
//
//  STRIPE (opcional, internacional):
//    STRIPE_SECRET_KEY → sk_test_... (sandbox gratuito en stripe.com/docs/testing)
//    Tarjeta prueba Stripe: 4242 4242 4242 4242 · CVV: any · Vto: cualquier futura
//
// ── INSTALACIÓN LOCAL ────────────────────────────────────────
//  npm install
//  node servidor.js        → http://localhost:3000
//
// ── DEPENDENCIAS (package.json) ─────────────────────────────
//  "dependencies": {
//    "express": "^4.18.2",
//    "ws": "^8.14.2",
//    "mercadopago": "^2.3.0",   ← SDK oficial MP v2
//    "pg": "^8.11.3"            ← solo si usás PostgreSQL
//  }
// ============================================================
const express   = require('express');
const http      = require('http');
const WebSocket = require('ws');
const path      = require('path');
const crypto    = require('crypto');
const webpush   = require('web-push');
const { hashPin, verificarPin, firmarToken, verificarToken, requireAuth, loginLimiter, apiLimiter } = require('./auth');

// ── PUSH NOTIFICATIONS (Web Push / VAPID) ────────────────────
// Claves por defecto incluidas para que funcione sin configuración extra —
// pero como son las MISMAS para todos los que usen este código tal cual,
// definí VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY propias en las variables de
// entorno de cada cliente/instancia antes de ir a producción en serio
// (si no, dos locales distintos con las mismas claves podrían, en teoría,
// leer las suscripciones push del otro si comparten infraestructura).
// Generar un par nuevo: node -e "console.log(require('web-push').generateVAPIDKeys())"
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC_KEY  || 'BL7E95KA2O2u-6a1OmUdO9CowCaBHltLOnGcuisdMquSCQ9paphLhp5SsMQuG2ygcCEmSmZYF4A8g8vbOUJKfbE';
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || 'QWXDyvh9SAMsqidETFxLRvj5fKkodyfOCOJoO2_-VCA';
webpush.setVapidDetails('mailto:' + (process.env.VAPID_EMAIL || 'soporte@iffyware.com'), VAPID_PUBLIC, VAPID_PRIVATE);

const PORT   = process.env.PORT || 3000;
// Nombre del producto dentro de la línea Iffyware Systems (PVDelivery, Depot,
// Seguros, etc.) — separado del logo para que el mismo logo-dev.jpg sirva
// para toda la línea; cada instancia lo cambia solo con esta variable de entorno.
const PRODUCTO_NOMBRE = process.env.PRODUCTO_NOMBRE || 'PVDelivery';
const PRODUCTO_VERSION = require('./package.json').version || '1.1.0';

const app    = express();
const server = http.createServer(app);
const wss    = new WebSocket.Server({ server });
app.use('/api', apiLimiter);

app.use(express.json({ limit: '10mb' }));
app.use((q, r, n) => {
  r.header('Access-Control-Allow-Origin', '*');
  r.header('Access-Control-Allow-Headers', 'Content-Type');
  r.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  if (q.method === 'OPTIONS') return r.sendStatus(200);
  n();
});

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

// ── Productos demo por defecto (overrideable via env) ─────────
// PRODUCTOS_DEFAULT: JSON array stringificado, o vacío para lista genérica
function productosDefault() {
  if (process.env.PRODUCTOS_DEFAULT) {
    try { return JSON.parse(process.env.PRODUCTOS_DEFAULT); } catch(e) {}
  }
  return [
    { id:1, nombre:'Hamburguesa',  precio:3000, categoria:'principal',      descripcion:'', imagen:null },
    { id:2, nombre:'Pizza',        precio:5000, categoria:'principal',      descripcion:'', imagen:null },
    { id:3, nombre:'Empanadas',    precio:1500, categoria:'principal',      descripcion:'', imagen:null },
    { id:4, nombre:'Coca Cola',    precio: 800, categoria:'bebida',         descripcion:'', imagen:null },
    { id:5, nombre:'Papas fritas', precio:1200, categoria:'acompanamiento', descripcion:'', imagen:null }
  ];
}

let ram = {
  pedidos: [],
  productos: productosDefault(),
  repartidores: [],
  clientes: [],
  promos: [],
  pagosSimulados: [],
  empleados: [],
  contador: 1,
  negocio:          process.env.NEGOCIO          || 'Mi Negocio',
  codigoLocal:      process.env.CODIGO_LOCAL      || generarCodigoLocal(),
  dirLocal:         process.env.DIR_LOCAL         || '',
  cbuLocal:         process.env.CBU_LOCAL         || '',
  aliasLocal:       process.env.ALIAS_LOCAL        || '',
  comisionTipo:     process.env.COMISION_TIPO     || 'por_km',
  comisionPorMetro: parseFloat(process.env.COMISION_POR_METRO || '0.60'),
  comisionFija:     parseFloat(process.env.COMISION_FIJA      || '0'),
  clave:            process.env.CLAVE_OPERADOR    || '1234',
  claveAdmin:       process.env.CLAVE_ADMIN       || '9999',
  turnoActivo: false,
  turnoApertura: null,
  turnoUsuario: null,
  turnoEfectivoInicial: 0,
  pushSubs: [],
  asistencias: []
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
    CREATE TABLE IF NOT EXISTS empleados   (id BIGINT PRIMARY KEY, data JSONB);
    CREATE TABLE IF NOT EXISTS push_subs   (id BIGINT PRIMARY KEY, rol TEXT, ref TEXT, endpoint TEXT UNIQUE, data JSONB);
    CREATE TABLE IF NOT EXISTS asistencias (id BIGINT PRIMARY KEY, empleado_id BIGINT, data JSONB);
  `);
  await pool.query('ALTER TABLE productos ADD COLUMN IF NOT EXISTS imagen TEXT').catch(() => {});
  await pool.query('ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS dni TEXT').catch(() => {});
  await pool.query('ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS foto TEXT').catch(() => {});
  await pool.query('ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT true').catch(() => {});
  await pool.query('ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS lat NUMERIC').catch(() => {});
  await pool.query('ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS lng NUMERIC').catch(() => {});

  const codigo = process.env.CODIGO_LOCAL || generarCodigoLocal();
  const _ne = (process.env.NEGOCIO||'Mi Negocio').replace(/'/g,"''");
  const _cl = (process.env.CLAVE_OPERADOR||'1234');
  const _ca = (process.env.CLAVE_ADMIN||'9999');
  const _ct = (process.env.COMISION_TIPO||'por_km');
  const _cm = (process.env.COMISION_POR_METRO||'0.60');
  const _cf = (process.env.COMISION_FIJA||'0');
  await pool.query(`INSERT INTO config(key,value) VALUES
    ('negocio','${_ne}'),('contador','1'),('codigoLocal','${codigo}'),
    ('dirLocal','${(process.env.DIR_LOCAL||'').replace(/'/g,"''")}'),
    ('cbuLocal','${(process.env.CBU_LOCAL||'').replace(/'/g,"''")}'),
    ('aliasLocal','${(process.env.ALIAS_LOCAL||'').replace(/'/g,"''")}'),
    ('comisionTipo','${_ct}'),('comisionPorMetro','${_cm}'),
    ('comisionFija','${_cf}'),('clave','${_cl}'),('claveAdmin','${_ca}')
    ON CONFLICT(key) DO NOTHING`);

  const c = await pool.query('SELECT COUNT(*) FROM productos');
  if (parseInt(c.rows[0].count) === 0) {
    for (const p of ram.productos)
      await pool.query('INSERT INTO productos VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
        [p.id, p.nombre, p.precio, p.categoria, p.descripcion, p.imagen]);
  }
  console.log('Base de datos lista.');
}

// Quita campos sensibles antes de mandar cualquier cosa al navegador.
// clave/claveAdmin/pin NUNCA deben viajar al cliente, ni por HTTP ni por WS.
function sinSensibles(db) {
  const { clave, claveAdmin, ...resto } = db;
  resto.empleados = (resto.empleados || []).map(({ pin, tarifaHora, ...e }) => e);
  // Las asistencias (horarios fichados, notas de gerente, sueldo) nunca se
  // difunden por WebSocket a todos los conectados — son datos internos de
  // nómina. Se acceden solo vía /api/asistencia/reporte (admin, autenticado).
  delete resto.asistencias;
  return resto;
}

async function getDB() {
  if (!useDB) {
    const full = {
      ...ram,
      pedidos: [...ram.pedidos],
      cbuLocal: ram.cbuLocal||'',
      aliasLocal: ram.aliasLocal||'',
      clientes: [...(ram.clientes||[])],
      pagosSimulados: [...(ram.pagosSimulados||[])],
      empleados: [...(ram.empleados||[])],
      comisionTipo: ram.comisionTipo||'por_km',
      comisionPorMetro: ram.comisionPorMetro||0.60,
      comisionFija: ram.comisionFija||0,
      clave: ram.clave||'1234',
      claveAdmin: ram.claveAdmin||'9999',
      turnoActivo: ram.turnoActivo||false,
      turnoApertura: ram.turnoApertura||null,
      turnoUsuario: ram.turnoUsuario||null,
      turnoEfectivoInicial: ram.turnoEfectivoInicial||0,
      productoNombre: PRODUCTO_NOMBRE,
      productoVersion: PRODUCTO_VERSION
    };
    return sinSensibles(full);
  }
  const [cfg, pr, re, pe, pm, cl, pg, emp] = await Promise.all([
    pool.query('SELECT key,value FROM config'),
    pool.query('SELECT * FROM productos ORDER BY id'),
    pool.query('SELECT * FROM repartidores ORDER BY id'),
    pool.query('SELECT id,data FROM pedidos ORDER BY id DESC'),
    pool.query('SELECT data FROM promos'),
    pool.query('SELECT data FROM clientes ORDER BY id DESC').catch(()=>({rows:[]})),
    pool.query('SELECT data FROM pagos_sim ORDER BY id DESC LIMIT 50').catch(()=>({rows:[]})),
    pool.query('SELECT data FROM empleados ORDER BY id').catch(()=>({rows:[]}))
  ]);
  const config = {};
  cfg.rows.forEach(r => config[r.key] = r.value);
  const full = {
    negocio:        config.negocio || 'Mi Negocio',
    contador:       parseInt(config.contador || '1'),
    codigoLocal:    config.codigoLocal || '',
    dirLocal:       config.dirLocal || '',
    cbuLocal:       config.cbuLocal || '',
    aliasLocal:     config.aliasLocal || '',
    comisionTipo:   config.comisionTipo || 'por_km',
    comisionPorMetro: parseFloat(config.comisionPorMetro||'0.60'),
    comisionFija:   parseFloat(config.comisionFija||'0'),
    clave:          config.clave || '1234',
    claveAdmin:     config.claveAdmin || '9999',
    productos:      pr.rows.map(r => ({ id:Number(r.id), nombre:r.nombre, precio:Number(r.precio), categoria:r.categoria, descripcion:r.descripcion||'', imagen:r.imagen||null, agotado:r.agotado||false })),
    repartidores:   re.rows.map(r => ({ id:Number(r.id), nombre:r.nombre, dni:r.dni||'', tel:r.tel, com:Number(r.com), foto:r.foto||null, activo:r.activo!==false, lat:r.lat?Number(r.lat):null, lng:r.lng?Number(r.lng):null })),
    pedidos:        pe.rows.map(r => ({ ...r.data, id:r.id })),
    promos:         pm.rows.map(r => r.data),
    clientes:       cl.rows.map(r => r.data),
    pagosSimulados: pg.rows.map(r => r.data),
    empleados:      emp.rows.map(r => r.data),
    productoNombre: PRODUCTO_NOMBRE,
    productoVersion: PRODUCTO_VERSION
  };
  return sinSensibles(full);
}

// getDB "interna" — SÍ trae clave/claveAdmin/pin en texto o hash, para
// usar en verificación server-side. Nunca exponer el resultado directo al cliente.
async function getDBInterna() {
  if (!useDB) return { ...ram, empleados: ram.empleados || [] };
  const cfg = await pool.query('SELECT key,value FROM config');
  const emp = await pool.query('SELECT data FROM empleados ORDER BY id').catch(()=>({rows:[]}));
  const config = {};
  cfg.rows.forEach(r => config[r.key] = r.value);
  return {
    clave: config.clave || '1234',
    claveAdmin: config.claveAdmin || '9999',
    empleados: emp.rows.map(r => r.data)
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
      // Identificación de rol
      if (msg.tipo === 'IDENTIFICAR_ROL') {
        ws.rol = msg.rol;
        ws.repId = msg.repId || null;
        if (msg.rol === 'caja') {
          cajaConectadaWs = ws;
          bcastLight({ tipo: 'CAJA_ESTADO', activa: true });
          console.log('Caja identificada por WS');
        }
        return;
      }
      // Reenviar mensajes de chat a todos los conectados
      if (msg.tipo === 'CHAT_MSG') {
        const t = JSON.stringify(msg);
        C.forEach(w => { if (w !== ws && w.readyState === WebSocket.OPEN) try { w.send(t); } catch(e){} });
      }
      // Rider puede mandar ubicación por WS directamente (más rápido que REST)
      if (msg.tipo === 'UBICACION_REP' && msg.repId && msg.lat && msg.lng) {
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

// ── PUSH NOTIFICATIONS ───────────────────────────────────────
async function guardarPushSub(rol, ref, subscription) {
  const id = Date.now() + Math.floor(Math.random()*1000);
  const row = { rol, ref: ref != null ? String(ref) : null, sub: subscription };
  if (useDB) {
    await pool.query(
      `INSERT INTO push_subs(id, rol, ref, endpoint, data) VALUES($1,$2,$3,$4,$5)
       ON CONFLICT(endpoint) DO UPDATE SET rol=$2, ref=$3, data=$5`,
      [id, rol, row.ref, subscription.endpoint, JSON.stringify(row)]
    );
  } else {
    ram.pushSubs = ram.pushSubs.filter(s => s.sub.endpoint !== subscription.endpoint);
    ram.pushSubs.push(row);
  }
}
async function borrarPushSubPorEndpoint(endpoint) {
  if (useDB) await pool.query('DELETE FROM push_subs WHERE endpoint=$1', [endpoint]).catch(()=>{});
  else ram.pushSubs = ram.pushSubs.filter(s => s.sub.endpoint !== endpoint);
}
async function listarPushSubs(rol, ref) {
  if (useDB) {
    const q = ref != null
      ? await pool.query('SELECT data FROM push_subs WHERE rol=$1 AND ref=$2', [rol, String(ref)])
      : await pool.query('SELECT data FROM push_subs WHERE rol=$1', [rol]);
    return q.rows.map(r => r.data);
  }
  return ram.pushSubs.filter(s => s.rol === rol && (ref == null || s.ref === String(ref)));
}
// Manda una notificación push a todas las suscripciones de un rol (y,
// opcionalmente, de una referencia puntual: id de pedido para 'cliente',
// id de repartidor para 'rep'). Si una suscripción quedó muerta (410/404 —
// el navegador la revocó), la borra sola para no acumular basura.
async function pushA(rol, ref, payload) {
  try {
    const subs = await listarPushSubs(rol, ref);
    await Promise.all(subs.map(async s => {
      try { await webpush.sendNotification(s.sub, JSON.stringify(payload)); }
      catch(e) { if (e.statusCode === 410 || e.statusCode === 404) await borrarPushSubPorEndpoint(s.sub.endpoint); }
    }));
  } catch(e) { console.error('[PUSH] error:', e.message); }
}

// ── API ───────────────────────────────────────────────────────
// ── KEEP-ALIVE: evita cold start en Railway plan gratuito ─────
// UptimeRobot apunta a GET /ping cada 5 minutos
app.get('/ping', (q, r) => r.json({ ok: true, ts: Date.now(), uptime: process.uptime() }));

// ── PUSH NOTIFICATIONS: API pública ───────────────────────────
app.get('/api/push/vapid-public-key', (q, r) => r.json({ publicKey: VAPID_PUBLIC }));

app.post('/api/push/subscribe', async (q, r) => {
  try {
    const { rol, ref, subscription } = q.body;
    if (!subscription?.endpoint || !['cliente','rep','local'].includes(rol)) {
      return r.status(400).json({ ok: false, error: 'Datos de suscripción inválidos' });
    }
    await guardarPushSub(rol, ref, subscription);
    r.json({ ok: true });
  } catch(e) { console.error(e); r.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/push/unsubscribe', async (q, r) => {
  try {
    if (q.body.endpoint) await borrarPushSubPorEndpoint(q.body.endpoint);
    r.json({ ok: true });
  } catch(e) { r.status(500).json({ ok: false, error: e.message }); }
});

// Auto-ping interno: si no hay DATABASE_URL o Railway duerme el proceso,
// este intervalo mantiene el event-loop activo y previene el cold start
// (funcioná junto a UptimeRobot o solo en desarrollo local)
const KEEP_ALIVE_MS = 4 * 60 * 1000; // 4 minutos
setInterval(() => {
  const used = process.memoryUsage();
  console.log(`[KeepAlive] uptime=${Math.round(process.uptime())}s | rss=${Math.round(used.rss/1024/1024)}MB | clients=${C.size}`);
}, KEEP_ALIVE_MS);

app.get('/api/db', async (q, r) => r.json(await getDB()));

// POST /api/auth/login — verifica el PIN del local (operador/admin) y devuelve JWT.
// Reemplaza la comparación que antes hacía el frontend contra db.clave/db.claveAdmin.
app.post('/api/auth/login', loginLimiter, async (q, r) => {
  try {
    const { pin } = q.body;
    if (!pin) return r.status(400).json({ ok: false, error: 'PIN requerido' });
    const interna = await getDBInterna();

    const chkAdmin = verificarPin(pin, interna.claveAdmin);
    if (chkAdmin.ok) {
      if (chkAdmin.necesitaRehash && useDB) {
        await pool.query("INSERT INTO config(key,value) VALUES('claveAdmin',$1) ON CONFLICT(key) DO UPDATE SET value=$1", [hashPin(pin)]);
      } else if (chkAdmin.necesitaRehash) { ram.claveAdmin = hashPin(pin); }
      return r.json({ ok: true, rol: 'admin', token: firmarToken({ rol: 'admin' }) });
    }
    const chkOp = verificarPin(pin, interna.clave);
    if (chkOp.ok) {
      if (chkOp.necesitaRehash && useDB) {
        await pool.query("INSERT INTO config(key,value) VALUES('clave',$1) ON CONFLICT(key) DO UPDATE SET value=$1", [hashPin(pin)]);
      } else if (chkOp.necesitaRehash) { ram.clave = hashPin(pin); }
      return r.json({ ok: true, rol: 'operador', token: firmarToken({ rol: 'operador' }) });
    }
    return r.json({ ok: false, error: 'PIN incorrecto' });
  } catch(e) { r.status(500).json({ ok: false, error: e.message }); }
});

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
    // BUGFIX: antes acá se pisaba SIEMPRE con estado:'pendiente', sin importar
    // lo que mandara el frontend. Eso hacía que pedidos con pago QR/tarjeta/
    // transferencia (que el cliente manda como estado:'esperando_pago') entraran
    // igual como 'pendiente' y salieran a cocina ANTES de que MP confirmara el
    // pago. Ahora se respeta 'esperando_pago' si vino así, y se ignora
    // cualquier otro valor que el cliente intente forzar (ej. 'entregado').
    const ESTADOS_INICIALES_PERMITIDOS = ['pendiente', 'esperando_pago'];
    const estadoInicial = ESTADOS_INICIALES_PERMITIDOS.includes(q.body.estado) ? q.body.estado : 'pendiente';
    let id, p;
    if (useDB) {
      const cRes = await pool.query("SELECT value FROM config WHERE key='contador'");
      id = parseInt(cRes.rows[0]?.value || '1');
      p = { ...q.body, id, fecha: new Date().toISOString(), estado: estadoInicial, hist: [{ e: estadoInicial, h: new Date().toLocaleTimeString() }] };
      await pool.query('INSERT INTO pedidos(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2', [id, JSON.stringify(p)]);
      await pool.query("UPDATE config SET value=$1 WHERE key='contador'", [String(id + 1)]);
    } else {
      id = ram.contador++;
      p = { ...q.body, id, fecha: new Date().toISOString(), estado: estadoInicial, hist: [{ e: estadoInicial, h: new Date().toLocaleTimeString() }] };
      ram.pedidos.unshift(p);
    }
    // Los pedidos 'esperando_pago' SÍ se difunden (para que caja los vea en la
    // cola de verificación de pago), pero el frontend los filtra fuera de la
    // vista de cocina (ver ESTADOS_ACTIVOS / renderCocina) hasta que
    // /api/mp/webhook (o el cajero, para transferencia/tarjeta) los confirme.
    bcastLight({ tipo: 'PEDIDO_NUEVO', pedido: p });
    pushA('local', null, estadoInicial === 'esperando_pago'
      ? { title: '💳 Pedido #' + p.id, body: 'Esperando verificación de pago', tag: 'pedido-'+p.id, url: '/' }
      : { title: '🔔 Nuevo pedido #' + p.id, body: (p.cli||'Cliente') + ' — $' + (p.total||0), tag: 'pedido-'+p.id, url: '/' });
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
    // BUGFIX (seguridad): "cancelado" antes solo se bloqueaba del lado del
    // cliente (JS), con un simple "if" que cualquiera podía saltarse abriendo
    // la consola del navegador y llamando a este endpoint directo — sin PIN,
    // sin login, nada. En un sistema que maneja pagos reales, cancelar un
    // pedido tiene que estar verificado en el servidor, no solo "ocultado"
    // en la interfaz. NOTA: el resto de las transiciones (preparando, camino,
    // entregado) siguen sin exigir token acá porque el repartidor (rol "rep")
    // no tiene sesión con JWT en este sistema — exigírselo también rompería
    // su flujo. Si en algún momento se quiere cerrar eso también, hay que
    // primero darle al repartidor una sesión autenticada real.
    if (estado === 'cancelado') {
      const header = q.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : null;
      const auth = token ? verificarToken(token) : null;
      if (!auth || auth.rol !== 'admin') {
        return r.status(403).json({ ok: false, error: 'Cancelar un pedido requiere autorización del gerente.' });
      }
    }
    // BUGFIX (seguridad): este endpoint no tiene auth porque el cliente lo usa
    // legítimamente para acciones sobre SU propio pedido (marcar "recibido",
    // cancelar). Pero eso significaba que cualquiera podía llamarlo también
    // para sacar un pedido de 'esperando_pago' sin que un cajero lo verificara
    // — la misma llamada que dispara el botón "Pago verificado". Ahora, ese
    // salto específico queda prohibido acá y se fuerza a pasar por los
    // endpoints protegidos /confirmar-pago y /rechazar-pago (requieren login).
    if (p.estado === 'esperando_pago' && estado !== 'esperando_pago') {
      return r.status(403).json({ ok: false, error: 'Este pedido espera verificación de pago. Usá el botón de caja para confirmarlo o rechazarlo.' });
    }
    const repIdAntes = p.repId;
    const estadoAntes = p.estado;
    p.estado = estado;
    if (cobro) p.cobro = cobro;
    if (horaEntrega) p.horaEntrega = horaEntrega;
    if (repId !== undefined) { p.repId = repId; p.repNombre = repNombre || null; }
    if (estado === 'entregado') p.pagado = true;
    if (q.body.listoRetiro !== undefined) p.listoRetiro = q.body.listoRetiro;
    if (q.body.kmRecorridos !== undefined) p.kmRecorridos = q.body.kmRecorridos;
    if (q.body.comisionKm !== undefined) p.comisionKm = q.body.comisionKm;
    if (q.body.kmEstimado !== undefined) p.kmEstimado = q.body.kmEstimado;
    if (q.body.devolucion !== undefined) p.devolucion = q.body.devolucion;
    if (q.body.noPudoEntregar !== undefined) p.noPudoEntregar = q.body.noPudoEntregar;
    if (q.body.motivoCancelacion !== undefined) p.motivoCancelacion = q.body.motivoCancelacion;
    if (q.body.canceladoPor !== undefined) p.canceladoPor = q.body.canceladoPor;
    p.hist = p.hist || [];
    p.hist.push({ e: estado, h: new Date().toLocaleTimeString() });
    if (useDB) await pool.query('UPDATE pedidos SET data=$1 WHERE id=$2', [JSON.stringify(p), id]);
    bcastLight({ tipo: 'PEDIDO_ACTUALIZADO', pedido: p });
    // Push: rider recién asignado a este pedido
    if (repId !== undefined && repId != null && repId !== repIdAntes) {
      pushA('rep', repId, { title: '🛵 Pedido #' + p.id + ' asignado', body: (p.dir||'Ver dirección en la app'), tag: 'pedido-'+p.id, url: '/' });
    }
    // Push: pedido listo para retirar (aviso a todos los riders activos)
    if (q.body.listoRetiro === true) {
      pushA('rep', null, { title: '✅ Pedido #' + p.id + ' listo para retirar', body: p.dir||'', tag: 'pedido-'+p.id, url: '/' });
    }
    // Push: pedido en camino / entregado → al cliente dueño del pedido
    if (estado === 'camino' && estadoAntes !== 'camino') {
      pushA('cliente', p.id, { title: '🛵 ¡Tu pedido está en camino!', body: (p.repNombre ? p.repNombre + ' lo está llevando' : 'El repartidor va hacia vos'), tag: 'pedido-'+p.id, url: '/?rol=cliente' });
    }
    if (estado === 'entregado' && estadoAntes !== 'entregado') {
      pushA('cliente', p.id, { title: '✅ ¡Pedido entregado!', body: 'Buen provecho 🎉', tag: 'pedido-'+p.id, url: '/?rol=cliente' });
    }
    r.json({ ok: true, pedido: p });
  } catch(e) { console.error(e); r.status(500).json({ error: e.message }); }
});

// Confirmar pago (SOLO personal logueado: cajero/gerente/admin) — saca el
// pedido de 'esperando_pago' y lo manda a cocina como 'pendiente'.
app.put('/api/pedidos/:id/confirmar-pago', requireAuth(), async (q, r) => {
  try {
    const id = parseInt(q.params.id);
    let p;
    if (useDB) {
      const res = await pool.query('SELECT data FROM pedidos WHERE id=$1', [id]);
      if (!res.rows.length) return r.status(404).json({ error: 'No encontrado' });
      p = { ...res.rows[0].data, id };
    } else {
      p = ram.pedidos.find(x => x.id === id);
      if (!p) return r.status(404).json({ error: 'No encontrado' });
    }
    if (p.estado !== 'esperando_pago') return r.status(409).json({ ok: false, error: 'Este pedido no está esperando verificación de pago.' });
    // BUGFIX (seguridad/lógica): antes cualquier pago 'esperando_pago' se
    // podía aprobar manualmente, incluidos los de tarjeta — pero un pago
    // con tarjeta no tiene ningún comprobante que un cajero pueda revisar a
    // ojo; "aprobarlo a mano" es simplemente saltearse el cobro. Solo se
    // permite la aprobación manual para transferencia (donde sí hay un
    // comprobante real que mirar). La tarjeta se confirma sola cuando MP
    // aprueba el pago (webhook / Payment Brick).
    if (p.mpago === 'tarjeta') {
      return r.status(403).json({ ok: false, error: 'Los pagos con tarjeta se confirman automáticamente cuando Mercado Pago los aprueba — no se pueden aprobar a mano. Si el cliente no completó el pago, cancelá el pedido.' });
    }
    p.estado = 'pendiente';
    p.pagado = true;
    p.pagadoPor = q.body?.pagadoPor || q.auth?.rol || 'Cajero';
    p.pagadoEn = new Date().toLocaleTimeString();
    p.hist = p.hist || [];
    p.hist.push({ e: 'pendiente', h: p.pagadoEn, via: 'confirmado_por_cajero' });
    if (useDB) await pool.query('UPDATE pedidos SET data=$1 WHERE id=$2', [JSON.stringify(p), id]);
    bcastLight({ tipo: 'PEDIDO_ACTUALIZADO', pedido: p });
    pushA('local', null, { title: '👨‍🍳 Pedido #' + p.id + ' a cocina', body: 'Pago verificado', tag: 'pedido-'+p.id, url: '/' });
    r.json({ ok: true, pedido: p });
  } catch(e) { console.error(e); r.status(500).json({ error: e.message }); }
});

// Rechazar pago (SOLO personal logueado) — cancela el pedido.
app.put('/api/pedidos/:id/rechazar-pago', requireAuth(), async (q, r) => {
  try {
    const id = parseInt(q.params.id);
    let p;
    if (useDB) {
      const res = await pool.query('SELECT data FROM pedidos WHERE id=$1', [id]);
      if (!res.rows.length) return r.status(404).json({ error: 'No encontrado' });
      p = { ...res.rows[0].data, id };
    } else {
      p = ram.pedidos.find(x => x.id === id);
      if (!p) return r.status(404).json({ error: 'No encontrado' });
    }
    if (p.estado !== 'esperando_pago') return r.status(409).json({ ok: false, error: 'Este pedido no está esperando verificación de pago.' });
    p.estado = 'cancelado';
    p.pagoRechazado = true;
    p.canceladoPor = q.auth?.rol || 'Cajero';
    p.hist = p.hist || [];
    p.hist.push({ e: 'cancelado', h: new Date().toLocaleTimeString(), via: 'pago_rechazado' });
    if (useDB) await pool.query('UPDATE pedidos SET data=$1 WHERE id=$2', [JSON.stringify(p), id]);
    bcastLight({ tipo: 'PEDIDO_ACTUALIZADO', pedido: p });
    pushA('cliente', p.id, { title: '❌ Pago no verificado', body: 'Tu pedido #' + p.id + ' fue cancelado — contactá al local', tag: 'pedido-'+p.id, url: '/?rol=cliente' });
    r.json({ ok: true, pedido: p });
  } catch(e) { console.error(e); r.status(500).json({ error: e.message }); }
});

// POST /api/pedidos/:id/calificar — el cliente califica al repartidor tras
// recibir su pedido. Sin auth (lo llama la app del cliente, que no tiene
// login), pero validado: solo se puede calificar un pedido 'entregado' que
// todavía no tenga calificación — evita que se vote dos veces el mismo pedido.
app.post('/api/pedidos/:id/calificar', async (q, r) => {
  try {
    const id = parseInt(q.params.id);
    const estrellas = parseInt(q.body.estrellas);
    const comentario = (q.body.comentario || '').toString().slice(0, 300);
    if (!estrellas || estrellas < 1 || estrellas > 5) {
      return r.status(400).json({ ok: false, error: 'Calificación inválida (1 a 5 estrellas).' });
    }
    let p;
    if (useDB) {
      const res = await pool.query('SELECT data FROM pedidos WHERE id=$1', [id]);
      if (res.rows.length) p = { ...res.rows[0].data, id };
    } else {
      p = ram.pedidos.find(x => x.id === id);
    }
    if (!p) return r.status(404).json({ ok: false, error: 'Pedido no encontrado.' });
    if (p.estado !== 'entregado') return r.status(409).json({ ok: false, error: 'Solo se puede calificar un pedido ya entregado.' });
    if (p.calificacion) return r.status(409).json({ ok: false, error: 'Este pedido ya fue calificado.' });
    p.calificacion = estrellas;
    if (comentario) p.calificacionComentario = comentario;
    p.calificacionEn = new Date().toISOString();
    if (useDB) await pool.query('UPDATE pedidos SET data=$1 WHERE id=$2', [JSON.stringify(p), id]);
    bcastLight({ tipo: 'PEDIDO_ACTUALIZADO', pedido: p });
    // Avisar al repartidor calificado (si tiene push activado) — sin exponer
    // el comentario en la notificación, solo las estrellas.
    if (p.repId) {
      pushA('rep', p.repId, { title: '⭐'.repeat(estrellas) + ' Nueva calificación', body: 'Pedido #' + p.id + ' — ' + estrellas + '/5', tag: 'calif-'+p.id, url: '/' });
    }
    r.json({ ok: true });
  } catch(e) { console.error(e); r.status(500).json({ ok: false, error: e.message }); }
});

app.delete('/api/pedidos', requireAuth('admin'), async (q, r) => {
  try {
    if (useDB) { await pool.query('DELETE FROM pedidos'); await pool.query("UPDATE config SET value='1' WHERE key='contador'"); }
    else { ram.pedidos = []; ram.contador = 1; }
    await bcast('ESTADO_INICIAL', {});
    r.json({ ok: true });
  } catch(e) { r.status(500).json({ error: e.message }); }
});

// GET /api/backup — descarga un dump completo de los datos operativos
// (pedidos, clientes, productos, empleados, repartidores, config del
// negocio). Nunca incluye claves de acceso (lo filtra sinSensibles).
app.get('/api/backup', requireAuth('admin'), async (q, r) => {
  try {
    const data = await getDB();
    r.setHeader('Content-Disposition', `attachment; filename="backup-${data.negocio||'pvdelivery'}-${new Date().toISOString().slice(0,10)}.json"`);
    r.json({ generadoEl: new Date().toISOString(), sistema: 'PVDelivery — Iffyware Systems', ...data });
  } catch(e) { r.status(500).json({ error: e.message }); }
});

// POST /api/reset — borra TODOS los datos operativos (pedidos, clientes,
// productos, empleados, repartidores, promos) y limpia los datos del
// negocio (nombre, dirección, CBU/alias). Mantiene las claves de acceso
// (clave/claveAdmin) para que el admin no quede afuera del sistema tras
// resetear. El logo del negocio vive en el navegador (localStorage), así
// que el frontend lo borra por su cuenta al llamar a este endpoint.
app.post('/api/reset', requireAuth('admin'), async (q, r) => {
  try {
    if (useDB) {
      await pool.query('DELETE FROM pedidos');
      await pool.query('DELETE FROM clientes');
      await pool.query('DELETE FROM promos');
      await pool.query('DELETE FROM pagos_sim');
      await pool.query('DELETE FROM empleados');
      await pool.query('DELETE FROM repartidores');
      await pool.query('DELETE FROM productos');
      for (const p of productosDefault())
        await pool.query('INSERT INTO productos VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',
          [p.id, p.nombre, p.precio, p.categoria, p.descripcion, p.imagen]);
      await pool.query(`UPDATE config SET value=$1 WHERE key='negocio'`, ['Mi Negocio']);
      await pool.query(`UPDATE config SET value=$1 WHERE key='dirLocal'`, ['']);
      await pool.query(`UPDATE config SET value=$1 WHERE key='cbuLocal'`, ['']);
      await pool.query(`UPDATE config SET value=$1 WHERE key='aliasLocal'`, ['']);
      await pool.query(`UPDATE config SET value='1' WHERE key='contador'`);
    } else {
      ram.pedidos = [];
      ram.clientes = [];
      ram.promos = [];
      ram.pagosSimulados = [];
      ram.empleados = [];
      ram.repartidores = [];
      ram.productos = productosDefault();
      ram.negocio = 'Mi Negocio';
      ram.dirLocal = '';
      ram.cbuLocal = '';
      ram.aliasLocal = '';
      ram.contador = 1;
      // clave y claveAdmin NO se tocan — a propósito, para no bloquear al admin.
    }
    await bcast('ESTADO_INICIAL', {});
    r.json({ ok: true });
  } catch(e) { console.error(e); r.status(500).json({ error: e.message }); }
});

app.delete('/api/pedidos/:id', requireAuth('admin'), async (q, r) => {
  try {
    const id = parseInt(q.params.id);
    if (useDB) {
      await pool.query('DELETE FROM pedidos WHERE id=$1', [id]);
    } else {
      const before = ram.pedidos.length;
      ram.pedidos = ram.pedidos.filter(x => x.id !== id);
      if (ram.pedidos.length === before) return r.status(404).json({ error: 'Pedido no encontrado' });
    }
    await bcast('DATOS_ACTUALIZADOS', {});
    r.json({ ok: true });
  } catch(e) { r.status(500).json({ error: e.message }); }
});

app.post('/api/repartidores', requireAuth('admin'), async (q, r) => {
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

app.delete('/api/repartidores/:id', requireAuth('admin'), async (q, r) => {
  try {
    const id = parseInt(q.params.id);
    if (useDB) await pool.query('DELETE FROM repartidores WHERE id=$1', [id]);
    else ram.repartidores = ram.repartidores.filter(x => x.id !== id);
    await bcast('DATOS_ACTUALIZADOS', {});
    r.json({ ok: true });
  } catch(e) { r.status(500).json({ error: e.message }); }
});

app.put('/api/repartidores/:id', requireAuth('admin'), async (q, r) => {
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

app.post('/api/productos', requireAuth('admin'), async (q, r) => {
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

app.put('/api/productos/:id', requireAuth('admin'), async (q, r) => {
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

app.delete('/api/productos/:id', requireAuth('admin'), async (q, r) => {
  try {
    const id = parseInt(q.params.id);
    if (useDB) await pool.query('DELETE FROM productos WHERE id=$1', [id]);
    else ram.productos = ram.productos.filter(x => x.id !== id);
    await bcast('DATOS_ACTUALIZADOS', {});
    r.json({ ok: true });
  } catch(e) { r.status(500).json({ error: e.message }); }
});

app.put('/api/config', requireAuth('admin'), async (q, r) => {
  try {
    if (q.body.negocio !== undefined) {
      if (useDB) await pool.query("INSERT INTO config(key,value) VALUES('negocio',$1) ON CONFLICT(key) DO UPDATE SET value=$1", [q.body.negocio]);
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
    if (q.body.clave !== undefined) {
      const h = hashPin(q.body.clave);
      if (useDB) await pool.query("INSERT INTO config(key,value) VALUES('clave',$1) ON CONFLICT(key) DO UPDATE SET value=$1", [h]);
      else ram.clave = h;
    }
    if (q.body.claveAdmin !== undefined) {
      const h = hashPin(q.body.claveAdmin);
      if (useDB) await pool.query("INSERT INTO config(key,value) VALUES('claveAdmin',$1) ON CONFLICT(key) DO UPDATE SET value=$1", [h]);
      else ram.claveAdmin = h;
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

// ── TURNO / APERTURA DE CAJA ──────────────────────────────
// GET  /api/turno         → estado actual del turno
// POST /api/turno/abrir   → abrir turno/caja
// POST /api/turno/cerrar  → cerrar turno/caja

app.get('/api/turno', async (q, r) => {
  r.json({
    turnoActivo: ram.turnoActivo || false,
    turnoApertura: ram.turnoApertura || null,
    turnoUsuario: ram.turnoUsuario || null,
    turnoEfectivoInicial: ram.turnoEfectivoInicial || 0
  });
});

app.post('/api/turno/abrir', requireAuth(), async (q, r) => {
  try {
    if (ram.turnoActivo) return r.json({ ok: false, error: 'Ya hay un turno activo' });
    const { usuario, efectivoInicial } = q.body;
    ram.turnoActivo = true;
    ram.turnoApertura = new Date().toISOString();
    ram.turnoUsuario = usuario || 'Cajero';
    ram.turnoEfectivoInicial = parseFloat(efectivoInicial) || 0;
    await bcast('TURNO_ABIERTO', { turnoActivo: true, turnoApertura: ram.turnoApertura, turnoUsuario: ram.turnoUsuario });
    console.log(`[TURNO] Abierto por ${ram.turnoUsuario} a las ${ram.turnoApertura}`);
    r.json({ ok: true, turnoApertura: ram.turnoApertura });
  } catch(e) { r.status(500).json({ error: e.message }); }
});

app.post('/api/turno/cerrar', requireAuth(), async (q, r) => {
  try {
    const turnoData = {
      apertura: ram.turnoApertura,
      cierre: new Date().toISOString(),
      usuario: ram.turnoUsuario,
      efectivoInicial: ram.turnoEfectivoInicial,
      pedidosDelTurno: ram.pedidos.filter(p =>
        p.estado === 'entregado' &&
        p.creadoEn && ram.turnoApertura &&
        new Date(p.creadoEn) >= new Date(ram.turnoApertura)
      ).length
    };
    ram.turnoActivo = false;
    ram.turnoApertura = null;
    ram.turnoUsuario = null;
    ram.turnoEfectivoInicial = 0;
    await bcast('TURNO_CERRADO', { turnoActivo: false, resumen: turnoData });
    console.log(`[TURNO] Cerrado — duración: apertura ${turnoData.apertura}`);
    r.json({ ok: true, resumen: turnoData });
  } catch(e) { r.status(500).json({ error: e.message }); }
});
app.post('/api/clientes', async (q, r) => {
  try {
    const { id, nombre, tel, dir, codigo } = q.body;
    const cliId = id || Date.now();
    const data = { id: cliId, nombre, tel, dir, codigo: codigo||null, fechaReg: new Date().toISOString() };
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
app.post('/api/pagos/simular', requireAuth(), async (q, r) => {
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

// ══════════════════════════════════════════════════════════════
// MERCADO PAGO — Integración real (Sandbox y Producción)
// Requiere: npm install mercadopago
// Variables de entorno:
//   MP_ACCESS_TOKEN  → Token de prueba (TEST-xxx) o producción (APP_USR-xxx)
//   MP_PUBLIC_KEY    → Public Key de prueba o producción
//   MP_WEBHOOK_SECRET → Secreto para validar webhooks (opcional)
//   MP_MODO          → 'sandbox' | 'production' (default: sandbox si el token empieza con TEST-)
// ══════════════════════════════════════════════════════════════
let mpClient = null;
let mpReady  = false;
let mpSandbox = true;

(function initMP() {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) {
    console.log('[MercadoPago] Sin MP_ACCESS_TOKEN — pagos en modo simulador');
    return;
  }
  try {
    const { MercadoPagoConfig, Preference, Payment } = require('mercadopago');
    mpClient = new MercadoPagoConfig({
      accessToken: token,
      options: { timeout: 10000 }
    });
    // Desde nov-2025, MP puede dar credenciales de PRUEBA con prefijo APP_USR-
    // (no solo TEST-) según el producto integrado — el prefijo solo ya no alcanza.
    // Por eso MP_MODO es la fuente de verdad si está definida; el prefijo TEST-
    // queda solo como respaldo automático cuando no se definió MP_MODO.
    if (process.env.MP_MODO === 'sandbox') mpSandbox = true;
    else if (process.env.MP_MODO === 'production') mpSandbox = false;
    else mpSandbox = token.startsWith('TEST-');
    mpReady = true;
    console.log(`[MercadoPago] SDK listo — modo: ${mpSandbox ? 'SANDBOX (pruebas)' : 'PRODUCCIÓN'}${process.env.MP_MODO ? ' (forzado por MP_MODO)' : ' (detectado por prefijo del token)'}`);
    if (!process.env.MP_MODO && !token.startsWith('TEST-')) {
      console.warn('[MercadoPago] ⚠️  Token sin prefijo TEST- y sin MP_MODO definida — si esta es una credencial de PRUEBA, definí MP_MODO=sandbox para evitar ambigüedad.');
    }
  } catch(e) {
    console.warn('[MercadoPago] SDK no instalado. Ejecutá: npm install mercadopago');
    console.warn('  Detalle:', e.message);
  }
})();

// GET /api/mp/status — informa si MP está configurado
app.get('/api/mp/status', (q, r) => {
  r.json({
    ok: true,
    mpReady,
    mpSandbox,
    publicKey: process.env.MP_PUBLIC_KEY || null,
    modo: mpReady ? (mpSandbox ? 'sandbox' : 'produccion') : 'simulador'
  });
});

// POST /api/mp/preference — crea una preferencia de pago en MercadoPago
// Body: { pedidoId, items:[{title,quantity,unit_price}], payer:{email}, back_urls }
app.post('/api/mp/preference', async (q, r) => {
  if (!mpReady) {
    return r.status(503).json({ ok: false, error: 'MercadoPago no configurado. Definí MP_ACCESS_TOKEN en variables de entorno.' });
  }
  try {
    const { Preference } = require('mercadopago');
    const prefApi = new Preference(mpClient);
    const { pedidoId, items, payer, back_urls, external_reference } = q.body;

    // Construir la preferencia
    const preferenceData = {
      items: (items && items.length > 0
        ? items.map(it => ({
            id:          String(it.id || pedidoId || Date.now()),
            title:       String(it.title || it.nombre || it.nom || 'Ítem').slice(0, 256),
            quantity:    Math.max(1, Math.round(Number(it.quantity || it.cant) || 1)),
            unit_price:  Math.max(1, Math.round(Number(it.unit_price || it.precio) || 1)),
            currency_id: 'ARS',
          }))
        : [{
            id:          String(pedidoId || Date.now()),
            title:       'Pedido #' + String(pedidoId || '').padStart(4, '0'),
            quantity:    1,
            unit_price:  Math.max(1, Math.round(Number(q.body.total || q.body.sub || 1))),
            currency_id: 'ARS',
          }]
      ),
      payer: {
        email: payer?.email || 'cliente@pvdelivery.com',
        name:  payer?.name  || '',
      },
      back_urls: {
        success: back_urls?.success || `${q.protocol}://${q.headers.host}/?mp=success`,
        failure: back_urls?.failure || `${q.protocol}://${q.headers.host}/?mp=failure`,
        pending: back_urls?.pending || `${q.protocol}://${q.headers.host}/?mp=pending`
      },
      auto_return: 'approved',
      external_reference: external_reference || String(pedidoId || Date.now()),
      notification_url: `${q.protocol}://${q.headers.host}/api/mp/webhook`,
      statement_descriptor: 'PVDELIVERY',
      // En sandbox las notif webhook no llegan, pero sí el redirect de back_urls
    };

    const response = await prefApi.create({ body: preferenceData });

    // Guardar referencia del pedido
    // Fallback: si mpSandbox=true pero MP no devolvió sandbox_init_point
    // (pasa con credenciales de prueba tipo APP_USR- del modelo Orders nuevo),
    // usar init_point igual — la credencial de prueba ya impide cobros reales.
    const initPoint = (mpSandbox && response.sandbox_init_point) ? response.sandbox_init_point : response.init_point;
    console.log(`[MP] Preferencia creada: ${response.id} — ${initPoint}`);

    r.json({
      ok: true,
      preferenceId: response.id,
      initPoint,           // URL de checkout de MercadoPago
      sandboxInitPoint: response.sandbox_init_point,
      mpSandbox
    });
  } catch(e) {
    console.error('[MP] Error creando preferencia:', e?.cause || e.message);
    r.status(500).json({ ok: false, error: e.message, detail: e?.cause });
  }
});

// POST /api/mp/webhook — recibe notificaciones de MercadoPago (IPN/Webhooks)
// MercadoPago envía eventos: payment.created, payment.updated, etc.
app.post('/api/mp/webhook', async (q, r) => {
  try {
    const { type, data, action } = q.body;
    console.log(`[MP Webhook] tipo: ${type} | acción: ${action} | id: ${data?.id}`);

    if ((type === 'payment' || action === 'payment.updated' || action === 'payment.created') && data?.id) {
      // Consultar el pago a la API de MP para verificar su estado real
      try {
        const { Payment } = require('mercadopago');
        const paymentApi = new Payment(mpClient);
        const payment = await paymentApi.get({ id: data.id });

        console.log(`[MP Webhook] Pago ${data.id}: status=${payment.status} | ref=${payment.external_reference}`);

        if (payment.status === 'approved') {
          // Buscar el pedido por external_reference
          const pedidoId = parseInt(payment.external_reference || '0');
          if (pedidoId) {
            // Actualizar pedido a confirmado y enviar a cocina
            let p = null;
            if (useDB) {
              const res = await pool.query('SELECT data FROM pedidos WHERE id=$1', [pedidoId]);
              if (res.rows.length) p = { ...res.rows[0].data, id: pedidoId };
            } else {
              p = ram.pedidos.find(x => x.id === pedidoId);
            }
            if (p && p.estado === 'esperando_pago') {
              p.estado = 'preparando';
              p.pagado = true;
              p.pagadoPor = 'mercadopago';
              p.pagadoEn = new Date().toISOString();
              p.mpPaymentId = data.id;
              p.hist = p.hist || [];
              p.hist.push({ e: 'preparando', h: new Date().toLocaleTimeString(), via: 'mp_webhook' });
              if (useDB) await pool.query('UPDATE pedidos SET data=$1 WHERE id=$2', [JSON.stringify(p), pedidoId]);
              bcastLight({ tipo: 'PEDIDO_ACTUALIZADO', pedido: p });
              pushA('local', null, { title: '👨‍🍳 Pedido #' + p.id + ' a cocina', body: 'Pago con Mercado Pago verificado automáticamente', tag: 'pedido-'+p.id, url: '/' });
              console.log(`[MP Webhook] ✅ Pedido #${pedidoId} aprobado y enviado a cocina`);
            }
          }
          // Registrar el pago
          const pagoId = Date.now();
          const pago = {
            id: pagoId, pedidoId: parseInt(payment.external_reference||'0'),
            monto: payment.transaction_amount, metodo: 'mercadopago',
            concepto: `MP #${data.id} — ${payment.payment_type_id}`,
            fecha: new Date().toISOString(), hora: new Date().toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit',second:'2-digit'}),
            estado: 'acreditado', referencia: String(data.id),
            mpStatus: payment.status, mpDetail: payment.status_detail
          };
          if (useDB) await pool.query('INSERT INTO pagos_sim(id,data) VALUES($1,$2) ON CONFLICT DO NOTHING', [pagoId, JSON.stringify(pago)]).catch(()=>{});
          else { if (!ram.pagosSimulados) ram.pagosSimulados = []; ram.pagosSimulados.unshift(pago); }
          bcastLight({ tipo: 'PAGO_NUEVO', pago });
        }
      } catch(err) {
        console.warn('[MP Webhook] No se pudo consultar el pago:', err.message);
      }
    }
    r.sendStatus(200); // MP requiere 200 o reintenta
  } catch(e) {
    console.error('[MP Webhook] Error:', e.message);
    r.sendStatus(200); // Siempre 200 para que MP no reintente
  }
});

// GET /api/mp/payment/:id — consulta el estado de un pago específico (para verificar después del redirect)
// Traduce los códigos de rechazo más comunes de MP a mensajes entendibles
function traducirRechazoMP(detail) {
  const m = {
    cc_rejected_insufficient_amount: 'Fondos insuficientes.',
    cc_rejected_bad_filled_card_number: 'Revisá el número de tarjeta.',
    cc_rejected_bad_filled_date: 'Revisá la fecha de vencimiento.',
    cc_rejected_bad_filled_security_code: 'Revisá el código de seguridad (CVV).',
    cc_rejected_bad_filled_other: 'Revisá los datos de la tarjeta.',
    cc_rejected_call_for_authorize: 'Tu banco requiere que autorices el pago — llamalo antes de reintentar.',
    cc_rejected_card_disabled: 'Tarjeta deshabilitada — contactá a tu banco.',
    cc_rejected_duplicated_payment: 'Ya se procesó un pago igual hace instantes.',
    cc_rejected_high_risk: 'El pago fue rechazado por seguridad. Probá con otro medio de pago.',
    cc_rejected_max_attempts: 'Superaste el máximo de intentos con esta tarjeta.',
    cc_rejected_other_reason: 'Tu banco rechazó el pago.'
  };
  return m[detail] || 'El pago fue rechazado. Probá con otra tarjeta u otro medio de pago.';
}

// POST /api/mp/pagar-tarjeta — cobra directo con el token que genera el
// Payment Brick del frontend (checkout embebido, sin salir de la app).
// Body: { pedidoId, token, payment_method_id, issuer_id, installments, payer }
app.post('/api/mp/pagar-tarjeta', async (q, r) => {
  if (!mpReady) return r.status(503).json({ ok: false, error: 'MercadoPago no configurado.' });
  try {
    const { pedidoId, token, payment_method_id, issuer_id, installments, payer, transaction_amount } = q.body;
    if (!pedidoId || !token || !payment_method_id) {
      return r.status(400).json({ ok: false, error: 'Datos de pago incompletos.' });
    }
    let p;
    if (useDB) {
      const res = await pool.query('SELECT data FROM pedidos WHERE id=$1', [pedidoId]);
      if (res.rows.length) p = { ...res.rows[0].data, id: pedidoId };
    } else {
      p = ram.pedidos.find(x => x.id === pedidoId);
    }
    if (!p) return r.status(404).json({ ok: false, error: 'Pedido no encontrado.' });
    if (p.estado !== 'esperando_pago') return r.status(409).json({ ok: false, error: 'Este pedido ya no está esperando pago.' });

    const { Payment } = require('mercadopago');
    const paymentApi = new Payment(mpClient);
    const payment = await paymentApi.create({
      body: {
        transaction_amount: Number(transaction_amount || p.total),
        token,
        description: 'Pedido #' + pedidoId,
        installments: Number(installments || 1),
        payment_method_id,
        issuer_id: issuer_id || undefined,
        payer: {
          email: payer?.email || 'cliente@pvdelivery.com',
          identification: payer?.identification || undefined
        },
        external_reference: String(pedidoId)
      },
      requestOptions: { idempotencyKey: 'pedido-' + pedidoId + '-' + Date.now() }
    });

    if (payment.status === 'approved') {
      p.estado = 'preparando';
      p.pagado = true;
      p.pagadoPor = 'mercadopago';
      p.pagadoEn = new Date().toISOString();
      p.mpPaymentId = payment.id;
      p.hist = p.hist || [];
      p.hist.push({ e: 'preparando', h: new Date().toLocaleTimeString(), via: 'mp_tarjeta' });
      if (useDB) await pool.query('UPDATE pedidos SET data=$1 WHERE id=$2', [JSON.stringify(p), pedidoId]);
      bcastLight({ tipo: 'PEDIDO_ACTUALIZADO', pedido: p });
      pushA('local', null, { title: '👨‍🍳 Pedido #' + p.id + ' a cocina', body: 'Pago con tarjeta verificado automáticamente', tag: 'pedido-'+p.id, url: '/' });
      return r.json({ ok: true, status: 'approved' });
    }
    if (payment.status === 'in_process' || payment.status === 'pending') {
      return r.json({ ok: true, status: payment.status, mensaje: 'Tu pago está siendo procesado — te avisamos apenas se confirme.' });
    }
    return r.json({ ok: false, status: payment.status, error: traducirRechazoMP(payment.status_detail) });
  } catch(e) {
    console.error('[MP Pagar Tarjeta] Error:', e.message);
    r.status(500).json({ ok: false, error: 'No se pudo procesar el pago. Probá de nuevo o con otro medio.' });
  }
});

app.get('/api/mp/payment/:id', async (q, r) => {
  if (!mpReady) return r.json({ ok: false, error: 'MP no configurado' });
  try {
    const { Payment } = require('mercadopago');
    const paymentApi = new Payment(mpClient);
    const payment = await paymentApi.get({ id: q.params.id });
    r.json({
      ok: true,
      status: payment.status,
      statusDetail: payment.status_detail,
      amount: payment.transaction_amount,
      externalRef: payment.external_reference,
      paymentType: payment.payment_type_id,
      mpSandbox
    });
  } catch(e) {
    r.status(500).json({ ok: false, error: e.message });
  }
});

// ══════════════════════════════════════════════════════════════
// MODO (billetera de bancos argentinos)
// Docs: https://docs.modo.com.ar
// Requiere registro como comercio en MODO: https://modo.com.ar/empresas
// Variables de entorno: MODO_CLIENT_ID, MODO_CLIENT_SECRET
// Estado: requiere acuerdo comercial previo con MODO
// ══════════════════════════════════════════════════════════════
app.get('/api/modo/status', (q, r) => {
  const modoReady = !!(process.env.MODO_CLIENT_ID && process.env.MODO_CLIENT_SECRET);
  r.json({ ok: true, modoReady, info: modoReady ? 'MODO configurado' : 'Pendiente de credenciales MODO — Registrarse en https://modo.com.ar/empresas' });
});

// ══════════════════════════════════════════════════════════════
// PERSONAL PAY (billetera de Telecom/Personal)
// PersonalPay no tiene API pública de e-commerce documentada.
// El método de pago disponible es cobro por QR (Interoperable DEBIN/QR BCRA).
// Para integrarlo como método de pago se usa el QR de CBU/CVU del local
// que el cliente escanea desde cualquier billetera (MP, Modo, Personal Pay, etc.)
// ══════════════════════════════════════════════════════════════
app.get('/api/personalpay/status', (q, r) => {
  r.json({ ok: true, info: 'PersonalPay acepta pagos via QR interoperable BCRA (mismo QR que CVU/CBU). No requiere integración API específica.' });
});
// ── EMPLEADOS (PIN de 4 dígitos, roles: cajero/cocinero/gerente) ──
app.get('/api/empleados', requireAuth('admin'), async (q, r) => {
  try {
    let lista;
    if (useDB) {
      const res = await pool.query('SELECT data FROM empleados ORDER BY id');
      lista = res.rows.map(x => x.data);
    } else {
      lista = ram.empleados || [];
    }
    r.json(lista.map(({ pin, ...e }) => e));
  } catch(e) { r.status(500).json({ error: e.message }); }
});

app.post('/api/empleados', requireAuth('admin'), async (q, r) => {
  try {
    const { nombre, rol, pin, foto, turnoEntrada, turnoSalida, tarifaHora } = q.body;
    if (!nombre || !pin || String(pin).length !== 4) return r.status(400).json({ error: 'Nombre y PIN de 4 dígitos requeridos' });
    const id = Date.now();
    const emp = {
      id, nombre, rol: rol || 'cajero', pin: hashPin(pin), activo: true, foto: foto||null, creadoEn: new Date().toISOString(),
      turnoEntrada: turnoEntrada || null, turnoSalida: turnoSalida || null, tarifaHora: Number(tarifaHora) || 0
    };
    if (useDB) {
      await pool.query('ALTER TABLE empleados ADD COLUMN IF NOT EXISTS data JSONB').catch(()=>{});
      await pool.query('INSERT INTO empleados(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2', [id, JSON.stringify(emp)]);
    } else {
      if (!ram.empleados) ram.empleados = [];
      ram.empleados.push(emp);
    }
    await bcast('DATOS_ACTUALIZADOS', {});
    const { pin: _p, ...empSinPin } = emp;
    r.json({ ok: true, empleado: empSinPin });
  } catch(e) { r.status(500).json({ error: e.message }); }
});

app.put('/api/empleados/:id', requireAuth('admin'), async (q, r) => {
  try {
    const id = parseInt(q.params.id);
    const { nombre, rol, pin, activo, turnoEntrada, turnoSalida, tarifaHora } = q.body;
    let emp;
    if (useDB) {
      const res = await pool.query('SELECT data FROM empleados WHERE id=$1', [id]);
      if (!res.rows.length) return r.status(404).json({ error: 'No encontrado' });
      emp = { ...res.rows[0].data };
    } else {
      emp = (ram.empleados||[]).find(x => x.id === id);
      if (!emp) return r.status(404).json({ error: 'No encontrado' });
    }
    if (nombre !== undefined) emp.nombre = nombre;
    if (rol !== undefined) emp.rol = rol;
    if (pin !== undefined) emp.pin = hashPin(pin);
    if (activo !== undefined) emp.activo = activo;
    if (turnoEntrada !== undefined) emp.turnoEntrada = turnoEntrada || null;
    if (turnoSalida !== undefined) emp.turnoSalida = turnoSalida || null;
    if (tarifaHora !== undefined) emp.tarifaHora = Number(tarifaHora) || 0;
    if (useDB) await pool.query('UPDATE empleados SET data=$1 WHERE id=$2', [JSON.stringify(emp), id]);
    await bcast('DATOS_ACTUALIZADOS', {});
    const { pin: _p, ...empSinPin } = emp;
    r.json({ ok: true, empleado: empSinPin });
  } catch(e) { r.status(500).json({ error: e.message }); }
});

app.delete('/api/empleados/:id', requireAuth('admin'), async (q, r) => {
  try {
    const id = parseInt(q.params.id);
    if (useDB) await pool.query('DELETE FROM empleados WHERE id=$1', [id]);
    else ram.empleados = (ram.empleados||[]).filter(x => x.id !== id);
    await bcast('DATOS_ACTUALIZADOS', {});
    r.json({ ok: true });
  } catch(e) { r.status(500).json({ error: e.message }); }
});

// POST /api/empleados/login — verifica PIN (hash bcrypt) y devuelve JWT + empleado.
app.post('/api/empleados/login', loginLimiter, async (q, r) => {
  try {
    const { pin } = q.body;
    if (!pin) return r.status(400).json({ ok: false, error: 'PIN requerido' });
    let emps;
    if (useDB) {
      const res = await pool.query('SELECT data FROM empleados');
      emps = res.rows.map(x => x.data);
    } else {
      emps = ram.empleados || [];
    }
    let encontrado = null;
    for (const e of emps) {
      if (e.activo === false) continue;
      const chk = verificarPin(pin, e.pin);
      if (chk.ok) { encontrado = e; if (chk.necesitaRehash) e.pin = hashPin(pin); break; }
    }
    if (!encontrado) return r.json({ ok: false, error: 'PIN incorrecto o empleado inactivo' });
    // Persistir el rehash si veníamos de un PIN viejo en texto plano
    if (useDB) await pool.query('UPDATE empleados SET data=$1 WHERE id=$2', [JSON.stringify(encontrado), encontrado.id]).catch(()=>{});
    const { pin: _omit, ...empSinPin } = encontrado;
    const token = firmarToken({ rol: encontrado.rol || 'cajero', empleadoId: encontrado.id });
    r.json({ ok: true, empleado: empSinPin, token });
  } catch(e) { r.status(500).json({ error: e.message }); }
});

// ── CONTROL DE ASISTENCIA ──────────────────────────────────────
async function _empleadoPorId(id) {
  if (useDB) {
    const res = await pool.query('SELECT data FROM empleados WHERE id=$1', [id]);
    return res.rows.length ? res.rows[0].data : null;
  }
  return (ram.empleados || []).find(e => e.id === id) || null;
}
async function _asistenciasDe(empleadoId) {
  if (useDB) {
    const res = await pool.query('SELECT data FROM asistencias WHERE empleado_id=$1 ORDER BY id', [empleadoId]);
    return res.rows.map(x => x.data);
  }
  return (ram.asistencias || []).filter(a => a.empleadoId === empleadoId);
}
async function _guardarAsistencia(a) {
  if (useDB) {
    await pool.query('INSERT INTO asistencias(id,empleado_id,data) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET data=$3', [a.id, a.empleadoId, JSON.stringify(a)]);
  } else {
    if (!ram.asistencias) ram.asistencias = [];
    const i = ram.asistencias.findIndex(x => x.id === a.id);
    if (i >= 0) ram.asistencias[i] = a; else ram.asistencias.push(a);
  }
}
function _hoyStr() { return new Date().toISOString().slice(0, 10); }
function _hhmmAhora() { return new Date().toTimeString().slice(0, 5); }

// POST /api/asistencia/entrada — el empleado ficha su propia entrada. La
// identidad sale del token (empleadoId), NUNCA del body — así nadie puede
// fichar por otro.
app.post('/api/asistencia/entrada', requireAuth(), async (q, r) => {
  try {
    const empleadoId = q.auth?.empleadoId;
    if (!empleadoId) return r.status(400).json({ ok: false, error: 'Esta cuenta no tiene un empleado asociado.' });
    const emp = await _empleadoPorId(empleadoId);
    if (!emp) return r.status(404).json({ ok: false, error: 'Empleado no encontrado.' });
    const hoy = _hoyStr();
    const existentes = await _asistenciasDe(empleadoId);
    const abierta = existentes.find(a => a.fecha === hoy && !a.horaSalida);
    if (abierta) return r.status(409).json({ ok: false, error: 'Ya tenés una entrada fichada hoy sin cerrar.' });
    const a = {
      id: Date.now(), empleadoId, empleadoNombre: emp.nombre,
      fecha: hoy, horaEntrada: _hhmmAhora(), horaEntradaTs: new Date().toISOString(),
      turnoSalidaEsperado: emp.turnoSalida || null,
      horaSalida: null, horaSalidaTs: null, salioAntes: false, autorizadoPor: null, nota: null,
      horasTrabajadas: null, tarifaHoraSnapshot: emp.tarifaHora || 0, pago: null
    };
    await _guardarAsistencia(a);
    r.json({ ok: true, asistencia: a });
  } catch(e) { console.error(e); r.status(500).json({ ok: false, error: e.message }); }
});

// POST /api/asistencia/salida — cierra la jornada abierta de hoy. Si es
// antes de la hora de salida programada, exige el PIN de un gerente/admin
// + nota. La autorización se valida en el servidor, nunca se confía en lo
// que mande el frontend sobre si "está autorizado".
app.post('/api/asistencia/salida', requireAuth(), async (q, r) => {
  try {
    const empleadoId = q.auth?.empleadoId;
    if (!empleadoId) return r.status(400).json({ ok: false, error: 'Esta cuenta no tiene un empleado asociado.' });
    const hoy = _hoyStr();
    const existentes = await _asistenciasDe(empleadoId);
    const abierta = existentes.find(a => a.fecha === hoy && !a.horaSalida);
    if (!abierta) return r.status(409).json({ ok: false, error: 'No tenés una entrada fichada hoy.' });

    const horaAhora = _hhmmAhora();
    const salioAntes = abierta.turnoSalidaEsperado ? (horaAhora < abierta.turnoSalidaEsperado) : false;
    let autorizadoPor = null;

    if (salioAntes) {
      const { pinGerente, nota } = q.body;
      if (!nota || !nota.trim()) return r.status(400).json({ ok: false, error: 'Salida anticipada: la nota es obligatoria.' });
      if (!pinGerente) return r.status(400).json({ ok: false, error: 'Salida anticipada: necesitás el PIN de un gerente para autorizar.' });
      // Validar el PIN: puede ser la clave general de admin, o el PIN de un
      // empleado con rol gerente/admin.
      let autorizado = false;
      const dbActual = await getDBInterna();
      if (pinGerente === dbActual.claveAdmin) { autorizado = true; autorizadoPor = 'Administrador'; }
      if (!autorizado) {
        const emps = useDB ? (await pool.query('SELECT data FROM empleados')).rows.map(x=>x.data) : (ram.empleados||[]);
        for (const e of emps) {
          if (e.activo === false) continue;
          if (e.rol !== 'gerente') continue;
          const chk = verificarPin(pinGerente, e.pin);
          if (chk.ok) { autorizado = true; autorizadoPor = e.nombre; break; }
        }
      }
      if (!autorizado) return r.status(403).json({ ok: false, error: 'PIN de gerente inválido.' });
      abierta.nota = nota.trim();
    }

    abierta.horaSalida = horaAhora;
    abierta.horaSalidaTs = new Date().toISOString();
    abierta.salioAntes = salioAntes;
    abierta.autorizadoPor = autorizadoPor;
    const ms = new Date(abierta.horaSalidaTs) - new Date(abierta.horaEntradaTs);
    abierta.horasTrabajadas = Math.round((ms / 3600000) * 100) / 100;
    abierta.pago = Math.round(abierta.horasTrabajadas * (abierta.tarifaHoraSnapshot || 0));
    await _guardarAsistencia(abierta);
    r.json({ ok: true, asistencia: abierta });
  } catch(e) { console.error(e); r.status(500).json({ ok: false, error: e.message }); }
});

// GET /api/asistencia/hoy — estado de fichado de HOY del empleado logueado.
app.get('/api/asistencia/hoy', requireAuth(), async (q, r) => {
  try {
    const empleadoId = q.auth?.empleadoId;
    if (!empleadoId) return r.json({ ok: true, asistencia: null });
    const hoy = _hoyStr();
    const existentes = await _asistenciasDe(empleadoId);
    const deHoy = existentes.filter(a => a.fecha === hoy).sort((a,b)=>b.id-a.id)[0] || null;
    r.json({ ok: true, asistencia: deHoy });
  } catch(e) { r.status(500).json({ ok: false, error: e.message }); }
});

// GET /api/asistencia/reporte?empleadoId=&desde=&hasta= — para armar la
// nómina. Solo admin.
app.get('/api/asistencia/reporte', requireAuth('admin'), async (q, r) => {
  try {
    const { empleadoId, desde, hasta } = q.query;
    let lista;
    if (useDB) {
      if (empleadoId) {
        const res = await pool.query('SELECT data FROM asistencias WHERE empleado_id=$1 ORDER BY id', [parseInt(empleadoId)]);
        lista = res.rows.map(x => x.data);
      } else {
        const res = await pool.query('SELECT data FROM asistencias ORDER BY id');
        lista = res.rows.map(x => x.data);
      }
    } else {
      lista = ram.asistencias || [];
      if (empleadoId) lista = lista.filter(a => a.empleadoId === parseInt(empleadoId));
    }
    if (desde) lista = lista.filter(a => a.fecha >= desde);
    if (hasta) lista = lista.filter(a => a.fecha <= hasta);
    const totalHoras = lista.reduce((s,a) => s + (a.horasTrabajadas || 0), 0);
    const totalPago = lista.reduce((s,a) => s + (a.pago || 0), 0);
    r.json({ ok: true, jornadas: lista, totalHoras: Math.round(totalHoras*100)/100, totalPago });
  } catch(e) { console.error(e); r.status(500).json({ ok: false, error: e.message }); }
});

// HTML — debe ir al final, después de todas las rutas /api/
// BUGFIX: sin esto, los navegadores cachean agresivamente el HTML y las
// imágenes (sobre todo logo-dev.jpg, que cambió de contenido varias veces
// con el mismo nombre de archivo) — por eso a veces "no se veía" un cambio
// recién subido: el navegador seguía sirviendo la versión vieja de su
// caché local, no una versión distinta a la que realmente estaba en el
// servidor. pvdelivery.html y el logo nunca deben cachearse; los íconos
// (que casi no cambian) sí pueden, con un tiempo corto.
app.use((q, r, next) => {
  if (q.path === '/' || q.path === '/pvdelivery.html' || q.path === '/logo-dev.jpg' || q.path === '/manifest.json' || q.path === '/sw.js') {
    r.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.use(express.static(path.join(__dirname), { maxAge: '1h' }));

// /.well-known/assetlinks.json — necesario para que el APK (TWA) de Android
// se abra sin la barra de direcciones del navegador. El contenido depende
// del fingerprint SHA256 del certificado con el que se firmó el APK — se
// completa después de generar el instalador (ver README-instaladores.md).
// Se define vía variable de entorno ANDROID_ASSETLINKS_JSON (string JSON)
// para no tener que tocar código por cada cliente/instancia.
app.get('/.well-known/assetlinks.json', (q, r) => {
  if (process.env.ANDROID_ASSETLINKS_JSON) {
    try { return r.json(JSON.parse(process.env.ANDROID_ASSETLINKS_JSON)); }
    catch(e) { return r.json([]); }
  }
  r.json([]);
});

// BUGFIX: antes esto era "app.get('*', ...)" sin condición — cualquier
// archivo estático que faltara (ej. si te olvidaste de subir logo-dev.png,
// icon-192.png, etc.) devolvía el pvdelivery.html COMPLETO con status 200,
// como si fuera ese archivo. El navegador entonces intentaba decodificar
// ese HTML como si fuera una imagen y fallaba en silencio — no había forma
// de darse cuenta por qué el logo no cargaba (ni un 404 en la pestaña Red).
// Ahora, si el pedido parece un archivo (tiene extensión) y no existe,
// se devuelve un 404 real; el fallback a pvdelivery.html queda solo para
// rutas de navegación (sin extensión), que es para lo que existe.
app.get('*', (q, r) => {
  if (/\.[a-zA-Z0-9]+$/.test(q.path)) return r.status(404).send('No encontrado: ' + q.path);
  r.sendFile(path.join(__dirname, 'pvdelivery.html'));
});

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