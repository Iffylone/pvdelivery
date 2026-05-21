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

const PORT   = process.env.PORT || 3000;

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
  { id:1, nombre:'Hamburguesa Clásica', precio:3500, categoria:'principal', descripcion:'Carne vacuna, lechuga, tomate, cebolla, mostaza', imagen:null },
  { id:2, nombre:'Hamburguesa Doble', precio:4800, categoria:'principal', descripcion:'Doble carne, doble queso, panceta, pepino', imagen:null },
  { id:3, nombre:'Hamburguesa Crispy Chicken', precio:4200, categoria:'principal', descripcion:'Pollo rebozado crocante, salsa ranch, lechuga', imagen:null },
  { id:4, nombre:'Milanesa Napolitana', precio:4500, categoria:'principal', descripcion:'Milanesa de ternera, jamón, queso, salsa', imagen:null },
  { id:5, nombre:'Medallón Veggie', precio:3800, categoria:'principal', descripcion:'Base de lentejas y garbanzos, sin TACC opción', imagen:null },
  { id:6, nombre:'Pizza Mozzarella', precio:5500, categoria:'pizza', descripcion:'Salsa de tomate, mozzarella, albahaca fresca', imagen:null },
  { id:7, nombre:'Pizza Pepperoni', precio:6200, categoria:'pizza', descripcion:'Pepperoni importado, mozzarella, orégano', imagen:null },
  { id:8, nombre:'Pizza 4 Quesos', precio:6500, categoria:'pizza', descripcion:'Mozzarella, provolone, brie, parmesano', imagen:null },
  { id:9, nombre:'Pizza Fugazzeta', precio:5800, categoria:'pizza', descripcion:'Cebolla caramelizada, mozzarella extra', imagen:null },
  { id:10, nombre:'Pizza Jamón y Morrones', precio:6000, categoria:'pizza', descripcion:'Jamón cocido, morrones asados, aceitunas', imagen:null },
  { id:11, nombre:'Empanada de Carne Suave', precio:900, categoria:'empanada', descripcion:'Carne picada, cebolla, huevo duro, aceitunas', imagen:null },
  { id:12, nombre:'Empanada de Pollo', precio:900, categoria:'empanada', descripcion:'Pollo desmenuzado, morrón rojo, especias', imagen:null },
  { id:13, nombre:'Empanada de Jamón y Queso', precio:850, categoria:'empanada', descripcion:'Jamón cocido y queso cremoso', imagen:null },
  { id:14, nombre:'Empanada Caprese', precio:900, categoria:'empanada', descripcion:'Tomate, mozzarella, albahaca — vegetariana', imagen:null },
  { id:15, nombre:'Empanada de Verdura', precio:850, categoria:'empanada', descripcion:'Acelga, huevo, ricota — vegetariana', imagen:null },
  { id:16, nombre:'Arepa Reina Pepiada', precio:2800, categoria:'arepa', descripcion:'Pollo, aguacate, mayonesa, cilantro', imagen:null },
  { id:17, nombre:'Arepa de Pabellón', precio:3200, categoria:'arepa', descripcion:'Carne mechada, caraotas negras, plátano maduro', imagen:null },
  { id:18, nombre:'Arepa Dominó', precio:2600, categoria:'arepa', descripcion:'Caraotas negras y queso blanco', imagen:null },
  { id:19, nombre:'Arepa de Pernil', precio:3000, categoria:'arepa', descripcion:'Pernil de cerdo marinado, papas chip', imagen:null },
  { id:20, nombre:'Sándwich Club', precio:3800, categoria:'sandwich', descripcion:'Pollo, panceta, tomate, lechuga, huevo, mayonesa', imagen:null },
  { id:21, nombre:'Lomito Completo', precio:4200, categoria:'sandwich', descripcion:'Lomo fino, queso, jamón, lechuga, tomate, huevo', imagen:null },
  { id:22, nombre:'Sándwich Veggie', precio:3200, categoria:'sandwich', descripcion:'Huevo, queso, rúcula, tomate, pesto — vegetariano', imagen:null },
  { id:23, nombre:'Tostado Mixto', precio:2200, categoria:'sandwich', descripcion:'Jamón y queso en pan lactal tostado', imagen:null },
  { id:24, nombre:'Papas Rellenas (x2)', precio:2500, categoria:'entrada', descripcion:'Papa rellena de carne o pollo, frita', imagen:null },
  { id:25, nombre:'Tabla de Picada', precio:5500, categoria:'entrada', descripcion:'Fiambres, quesos, aceitunas, pan — para 2', imagen:null },
  { id:26, nombre:'Alitas BBQ (x6)', precio:3200, categoria:'entrada', descripcion:'Pollo en salsa BBQ ahumada, con dips', imagen:null },
  { id:27, nombre:'Tostadas Bruschetta', precio:2000, categoria:'entrada', descripcion:'Pan tostado, tomate fresco, ajo, albahaca', imagen:null },
  { id:28, nombre:'Papas Fritas Simples', precio:1400, categoria:'acompanamiento', descripcion:'Papas en bastón, sal gruesa', imagen:null },
  { id:29, nombre:'Papas con Cheddar', precio:1800, categoria:'acompanamiento', descripcion:'Papas fritas con salsa de queso cheddar', imagen:null },
  { id:30, nombre:'Aros de Cebolla', precio:1600, categoria:'acompanamiento', descripcion:'Cebolla rebozada crocante, salsa ranch', imagen:null },
  { id:31, nombre:'Ensalada Verde', precio:1200, categoria:'acompanamiento', descripcion:'Lechuga, rúcula, tomate cherry, aceto', imagen:null },
  { id:32, nombre:'Porción de Arroz', precio:900, categoria:'acompanamiento', descripcion:'Arroz blanco con mantequilla', imagen:null },
  { id:33, nombre:'Coca-Cola 500ml', precio:900, categoria:'bebida', descripcion:'Lata o botella fría', imagen:null },
  { id:34, nombre:'Sprite 500ml', precio:900, categoria:'bebida', descripcion:'Lata o botella fría', imagen:null },
  { id:35, nombre:'Agua Mineral 500ml', precio:700, categoria:'bebida', descripcion:'Con o sin gas', imagen:null },
  { id:36, nombre:'Jugo de Naranja Natural', precio:1200, categoria:'bebida', descripcion:'Naranja exprimida al momento, sin azúcar', imagen:null },
  { id:37, nombre:'Limonada con Jengibre', precio:1400, categoria:'bebida', descripcion:'Limón, jengibre, menta, endulzante natural', imagen:null },
  { id:38, nombre:'Café con Leche', precio:950, categoria:'bebida', descripcion:'Café espresso doble, leche vaporizada', imagen:null },
  { id:39, nombre:'Té o Mate Cocido', precio:800, categoria:'bebida', descripcion:'Saquito a elección, con limón', imagen:null },
  { id:40, nombre:'Cerveza Quilmes 500ml', precio:1500, categoria:'bebida', descripcion:'Botella bien fría', imagen:null },
  { id:41, nombre:'Cerveza Artesanal', precio:2200, categoria:'bebida', descripcion:'Rotativa del día, preguntar variedad', imagen:null },
  { id:42, nombre:'Licuado de Frutas', precio:1500, categoria:'bebida', descripcion:'Banana, frutilla, durazno o mezcla — con leche', imagen:null },
  { id:43, nombre:'Alfajor Triple de Chocolate', precio:1600, categoria:'postre', descripcion:'Relleno de dulce de leche, bañado en chocolate', imagen:null },
  { id:44, nombre:'Brownie con Helado', precio:2200, categoria:'postre', descripcion:'Brownie tibio, bola de vainilla, salsa de cacao', imagen:null },
  { id:45, nombre:'Flan con Crema', precio:1400, categoria:'postre', descripcion:'Flan casero, doble crema, caramelo', imagen:null },
  { id:46, nombre:'Cheesecake de Frutos Rojos', precio:2500, categoria:'postre', descripcion:'Base de galletita, crema philadelphia, frutos rojos', imagen:null },
  { id:47, nombre:'Medialunas (x3)', precio:1100, categoria:'postre', descripcion:'Medialunas de manteca, tibias', imagen:null },
  { id:48, nombre:'Combo 1 — Básico', precio:5500, categoria:'combo', descripcion:'Hamburguesa Clásica + Papas Fritas + Bebida 500ml', imagen:null },
  { id:49, nombre:'Combo 2 — Doble', precio:7200, categoria:'combo', descripcion:'Hamburguesa Doble + Papas con Cheddar + Bebida', imagen:null },
  { id:50, nombre:'Combo 3 — Pizza Personal', precio:6500, categoria:'combo', descripcion:'Pizza Mozzarella personal + Bebida 500ml', imagen:null },
  { id:51, nombre:'Combo 4 — Arepa & +', precio:5200, categoria:'combo', descripcion:'Arepa Reina Pepiada + Papas Fritas + Jugo', imagen:null },
  { id:52, nombre:'Combo 5 — Familiar', precio:12500, categoria:'combo', descripcion:'Pizza entera + 8 Empanadas + 2 Bebidas 500ml', imagen:null },
  { id:53, nombre:'Combo 6 — Sandwich Completo', precio:6200, categoria:'combo', descripcion:'Lomito Completo + Papas Fritas + Bebida', imagen:null },
  { id:54, nombre:'Combo 7 — Empanadas x6', precio:5000, categoria:'combo', descripcion:'6 Empanadas surtidas a elección + Bebida', imagen:null }
],
  repartidores: [],
  clientes: [],
  promos: [],
  pagosSimulados: [],
  empleados: [],
  contador: 1,
  negocio: 'Mi Negocio',
  codigoLocal: generarCodigoLocal(),
  dirLocal: '',
  cbuLocal: '',
  aliasLocal: '',
  comisionTipo: 'por_km',
  comisionPorMetro: 0.60,
  comisionFija: 0,
  clave: '1234',
  claveAdmin: '9999',
  turnoActivo: false,         // true cuando hay una caja abierta
  turnoApertura: null,        // ISO timestamp del momento de apertura
  turnoUsuario: null,         // nombre del operador que abrió caja
  turnoEfectivoInicial: 0     // monto en efectivo al abrir caja
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
  `);
  await pool.query('ALTER TABLE productos ADD COLUMN IF NOT EXISTS imagen TEXT').catch(() => {});
  await pool.query('ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS dni TEXT').catch(() => {});
  await pool.query('ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS foto TEXT').catch(() => {});
  await pool.query('ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS activo BOOLEAN DEFAULT true').catch(() => {});
  await pool.query('ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS lat NUMERIC').catch(() => {});
  await pool.query('ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS lng NUMERIC').catch(() => {});

  const codigo = generarCodigoLocal();
  await pool.query(`INSERT INTO config(key,value) VALUES('negocio','Mi Negocio'),('contador','1'),('codigoLocal','${codigo}'),('dirLocal',''),('comisionTipo','por_km'),('comisionPorMetro','0.60'),('comisionFija','0'),('clave','1234'),('claveAdmin','9999') ON CONFLICT(key) DO NOTHING`);

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
    empleados: [...(ram.empleados||[])],
    comisionTipo: ram.comisionTipo||'por_km',
    comisionPorMetro: ram.comisionPorMetro||0.60,
    comisionFija: ram.comisionFija||0,
    clave: ram.clave||'1234',
    claveAdmin: ram.claveAdmin||'9999',
    turnoActivo: ram.turnoActivo||false,
    turnoApertura: ram.turnoApertura||null,
    turnoUsuario: ram.turnoUsuario||null,
    turnoEfectivoInicial: ram.turnoEfectivoInicial||0
  };
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
    clave:          config.clave || '1234',
    claveAdmin:     config.claveAdmin || '9999',
    productos:      pr.rows.map(r => ({ id:Number(r.id), nombre:r.nombre, precio:Number(r.precio), categoria:r.categoria, descripcion:r.descripcion||'', imagen:r.imagen||null, agotado:r.agotado||false })),
    repartidores:   re.rows.map(r => ({ id:Number(r.id), nombre:r.nombre, dni:r.dni||'', tel:r.tel, com:Number(r.com), foto:r.foto||null, activo:r.activo!==false, lat:r.lat?Number(r.lat):null, lng:r.lng?Number(r.lng):null })),
    pedidos:        pe.rows.map(r => ({ ...r.data, id:r.id })),
    promos:         pm.rows.map(r => r.data),
    clientes:       cl.rows.map(r => r.data),
    pagosSimulados: pg.rows.map(r => r.data),
    empleados:      emp.rows.map(r => r.data)
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
// ── KEEP-ALIVE: evita cold start en Railway plan gratuito ─────
// UptimeRobot apunta a GET /ping cada 5 minutos
app.get('/ping', (q, r) => r.json({ ok: true, ts: Date.now(), uptime: process.uptime() }));

// Auto-ping interno: si no hay DATABASE_URL o Railway duerme el proceso,
// este intervalo mantiene el event-loop activo y previene el cold start
// (funcioná junto a UptimeRobot o solo en desarrollo local)
const KEEP_ALIVE_MS = 4 * 60 * 1000; // 4 minutos
setInterval(() => {
  const used = process.memoryUsage();
  console.log(`[KeepAlive] uptime=${Math.round(process.uptime())}s | rss=${Math.round(used.rss/1024/1024)}MB | clients=${C.size}`);
}, KEEP_ALIVE_MS);

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
    if (q.body.noPudoEntregar !== undefined) p.noPudoEntregar = q.body.noPudoEntregar;
    if (q.body.motivoCancelacion !== undefined) p.motivoCancelacion = q.body.motivoCancelacion;
    if (q.body.canceladoPor !== undefined) p.canceladoPor = q.body.canceladoPor;
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

app.delete('/api/pedidos/:id', async (q, r) => {
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

// ── REIMPORTAR productos default (solo gerente/admin) ────────
app.post('/api/productos/reimportar-default', async (q, r) => {
  try {
    const productosDefault = ram.productos; // usa el listado embebido en ram
    let insertados = 0;
    if (useDB) {
      // Limpiar y recargar
      await pool.query('DELETE FROM productos');
      for (const p of productosDefault) {
        await pool.query('INSERT INTO productos VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET nombre=$2,precio=$3,categoria=$4,descripcion=$5,imagen=$6',
          [p.id, p.nombre, p.precio, p.categoria, p.descripcion, p.imagen]);
        insertados++;
      }
    } else {
      ram.productos = productosDefault.map(p => ({...p}));
      insertados = ram.productos.length;
    }
    await bcast('DB_UPDATE', {});
    r.json({ ok: true, insertados });
  } catch(e) { r.json({ ok: false, error: e.message }); }
});

// ── CREAR COMBO (producto con tipo combo) ─────────────────────
app.post('/api/productos/combo', async (q, r) => {
  try {
    const { nombre, precio, descripcion, items } = q.body;
    if (!nombre || !precio) return r.json({ ok: false, error: 'Nombre y precio requeridos' });
    const id = Date.now();
    const prod = { id, nombre, precio: parseInt(precio), categoria: 'combo', descripcion: descripcion || (items?.join(', ') || ''), imagen: null };
    if (useDB) {
      await pool.query('INSERT INTO productos VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET nombre=$2,precio=$3,categoria=$4,descripcion=$5,imagen=$6',
        [id, prod.nombre, prod.precio, prod.categoria, prod.descripcion, prod.imagen]);
    } else {
      ram.productos.push(prod);
    }
    await bcast('DB_UPDATE', {});
    r.json({ ok: true, producto: prod });
  } catch(e) { r.json({ ok: false, error: e.message }); }
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
    if (q.body.clave !== undefined) {
      if (useDB) await pool.query("INSERT INTO config(key,value) VALUES('clave',$1) ON CONFLICT(key) DO UPDATE SET value=$1", [q.body.clave]);
      else ram.clave = q.body.clave;
    }
    if (q.body.claveAdmin !== undefined) {
      if (useDB) await pool.query("INSERT INTO config(key,value) VALUES('claveAdmin',$1) ON CONFLICT(key) DO UPDATE SET value=$1", [q.body.claveAdmin]);
      else ram.claveAdmin = q.body.claveAdmin;
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

app.post('/api/turno/abrir', async (q, r) => {
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

app.post('/api/turno/cerrar', async (q, r) => {
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
    mpSandbox = token.startsWith('TEST-') || process.env.MP_MODO === 'sandbox';
    mpReady = true;
    console.log(`[MercadoPago] SDK listo — modo: ${mpSandbox ? 'SANDBOX (pruebas)' : 'PRODUCCIÓN'}`);
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
    const initPoint = mpSandbox ? response.sandbox_init_point : response.init_point;
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
app.get('/api/empleados', async (q, r) => {
  try {
    if (useDB) {
      const res = await pool.query('SELECT data FROM empleados ORDER BY id');
      r.json(res.rows.map(x => x.data));
    } else {
      r.json(ram.empleados || []);
    }
  } catch(e) { r.status(500).json({ error: e.message }); }
});

app.post('/api/empleados', async (q, r) => {
  try {
    const { nombre, rol, pin, foto } = q.body;
    if (!nombre || !pin || String(pin).length !== 4) return r.status(400).json({ error: 'Nombre y PIN de 4 dígitos requeridos' });
    const id = Date.now();
    const emp = { id, nombre, rol: rol || 'cajero', pin: String(pin), activo: true, foto: foto||null, creadoEn: new Date().toISOString() };
    if (useDB) {
      await pool.query('ALTER TABLE empleados ADD COLUMN IF NOT EXISTS data JSONB').catch(()=>{});
      await pool.query('INSERT INTO empleados(id,data) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET data=$2', [id, JSON.stringify(emp)]);
    } else {
      if (!ram.empleados) ram.empleados = [];
      ram.empleados.push(emp);
    }
    await bcast('DATOS_ACTUALIZADOS', {});
    r.json({ ok: true, empleado: emp });
  } catch(e) { r.status(500).json({ error: e.message }); }
});

app.put('/api/empleados/:id', async (q, r) => {
  try {
    const id = parseInt(q.params.id);
    const { nombre, rol, pin, activo } = q.body;
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
    if (pin !== undefined) emp.pin = String(pin);
    if (activo !== undefined) emp.activo = activo;
    if (useDB) await pool.query('UPDATE empleados SET data=$1 WHERE id=$2', [JSON.stringify(emp), id]);
    await bcast('DATOS_ACTUALIZADOS', {});
    r.json({ ok: true, empleado: emp });
  } catch(e) { r.status(500).json({ error: e.message }); }
});

app.delete('/api/empleados/:id', async (q, r) => {
  try {
    const id = parseInt(q.params.id);
    if (useDB) await pool.query('DELETE FROM empleados WHERE id=$1', [id]);
    else ram.empleados = (ram.empleados||[]).filter(x => x.id !== id);
    await bcast('DATOS_ACTUALIZADOS', {});
    r.json({ ok: true });
  } catch(e) { r.status(500).json({ error: e.message }); }
});

// POST /api/empleados/login — verifica PIN y devuelve el empleado
app.post('/api/empleados/login', async (q, r) => {
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
    const emp = emps.find(e => e.pin === String(pin) && e.activo !== false);
    if (!emp) return r.json({ ok: false, error: 'PIN incorrecto o empleado inactivo' });
    r.json({ ok: true, empleado: emp });
  } catch(e) { r.status(500).json({ error: e.message }); }
});

// HTML — debe ir al final, después de todas las rutas /api/
app.use(express.static(path.join(__dirname)));
app.get('*', (q, r) => r.sendFile(path.join(__dirname, 'pvdelivery.html')));

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
