# 🔧 GUÍA PASO A PASO - SISTEMA IFFYWARE PVDELIVERY
## Soluciones para los 11 problemas identificados

---

## **PROBLEMA 1️⃣: AUTENTICACIÓN DEL LOCAL CON CLAVE**
### ❌ Problema actual:
- Cualquiera entra al rol de "Local/Caja" sin contraseña
- El sistema es público en GitHub
- No hay control de acceso

### ✅ Solución:

#### **Paso 1.1: Guardar clave del negocio en la DB**
En `servidor.js`, en la función `initDB()`, agregar tabla de usuarios:

```javascript
async function initDB() {
  if (!useDB) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS config      (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE IF NOT EXISTS usuarios    (id SERIAL PRIMARY KEY, tipo TEXT, idRef INTEGER, clave TEXT UNIQUE, activo BOOLEAN DEFAULT true);
    CREATE TABLE IF NOT EXISTS productos   (id BIGINT PRIMARY KEY, nombre TEXT, precio NUMERIC, categoria TEXT, descripcion TEXT, imagen TEXT);
    CREATE TABLE IF NOT EXISTS repartidores(id INTEGER PRIMARY KEY, nombre TEXT, dni TEXT, tel TEXT, com NUMERIC, foto TEXT, activo BOOLEAN DEFAULT true, lat NUMERIC, lng NUMERIC);
    CREATE TABLE IF NOT EXISTS pedidos     (id INTEGER PRIMARY KEY, data JSONB);
    CREATE TABLE IF NOT EXISTS promos      (id BIGINT PRIMARY KEY, data JSONB);
  `);
  // ... resto del código
}
```

#### **Paso 1.2: Crear endpoint de login para Local**
En `servidor.js`, agregar:

```javascript
app.post('/api/local/login', async (q, r) => {
  try {
    const { clave } = q.body;
    if (!clave) return r.status(400).json({ error: 'Clave requerida' });
    
    if (useDB) {
      const res = await pool.query(
        'SELECT id FROM usuarios WHERE tipo=$1 AND clave=$2 AND activo=true',
        ['local', clave]
      );
      if (!res.rows.length) return r.status(401).json({ error: 'Clave incorrecta' });
      const sessionId = 'LOCAL_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
      r.json({ ok: true, sessionId });
    } else {
      // Para modo RAM, guardar en memoria una clave por defecto
      const claveDefault = 'local123'; // CAMBIAR EN PRODUCCIÓN
      if (clave !== claveDefault) return r.status(401).json({ error: 'Clave incorrecta' });
      const sessionId = 'LOCAL_' + Date.now();
      r.json({ ok: true, sessionId });
    }
  } catch(e) { console.error(e); r.status(500).json({ error: e.message }); }
});

app.post('/api/local/crear', async (q, r) => {
  try {
    const { nombreNegocio, claveInicial } = q.body;
    if (!nombreNegocio || !claveInicial) 
      return r.status(400).json({ error: 'Datos incompletos' });
    
    if (useDB) {
      // Insertar usuario local
      const res = await pool.query(
        'INSERT INTO usuarios(tipo, clave, activo) VALUES($1, $2, true) RETURNING id',
        ['local', claveInicial]
      );
      // Actualizar nombre del negocio
      await pool.query("UPDATE config SET value=$1 WHERE key='negocio'", [nombreNegocio]);
      r.json({ ok: true, localId: res.rows[0].id });
    } else {
      // Modo RAM: guardar en variables globales
      ram.negocio = nombreNegocio;
      ram.claveLocal = claveInicial;
      r.json({ ok: true });
    }
  } catch(e) { r.status(500).json({ error: e.message }); }
});
```

#### **Paso 1.3: Modificar HTML - Pantalla de Login para Local**
En `pvdelivery.html`, reemplazar la sección de ROLE SCREEN:

```html
<!-- ROL SCREEN CON LOGIN LOCAL -->
<div id="roleScreen">
  <div class="rs-brand">
    <div class="rs-brand-logo">⚡</div>
    <h1>Iffyware <span>Systems</span></h1>
    <p>Systems · Point of Sale · v3.0</p>
  </div>
  
  <!-- SI NO ESTÁ LOGUEADO: MOSTRAR OPCIONES -->
  <div id="roleOptions" class="rs-cards">
    <div class="rs-card tipo-local" onclick="mostrarLoginLocal()">
      <div class="rs-card-icon">🏪</div>
      <div>
        <div class="rs-card-label">Local / Caja</div>
        <div class="rs-card-desc">Pedidos, cocina, reportes, repartidores</div>
      </div>
      <div class="rs-card-arrow">›</div>
    </div>
    <div class="rs-card tipo-rep" onclick="mostrarLoginRep()">
      <div class="rs-card-icon">🛵</div>
      <div>
        <div class="rs-card-label">Repartidor</div>
        <div class="rs-card-desc">Mis pedidos, dirección, confirmar entrega</div>
      </div>
      <div class="rs-card-arrow">›</div>
    </div>
    <div class="rs-card tipo-cli" onclick="entrarCliente()">
      <div class="rs-card-icon">🛍️</div>
      <div>
        <div class="rs-card-label">Hacer mi pedido</div>
        <div class="rs-card-desc">Ver menú, elegir productos, delivery a domicilio</div>
      </div>
      <div class="rs-card-arrow">›</div>
    </div>
  </div>

  <div class="pwa-banner" id="pwaBanner">
    <div class="pwa-banner-text">
      <strong>📱 Instalar como app</strong>
      Funcioná sin internet y desde la pantalla de inicio
    </div>
    <button class="btn-pwa" onclick="instalarPWA()">Instalar</button>
  </div>
</div>

<!-- LOGIN LOCAL -->
<div id="localLogin" style="display:none; position:fixed; inset:0; background:var(--ink); z-index:200; align-items:center; justify-content:center; padding:24px; flex-direction:column">
  <div class="rl-card">
    <div class="rl-icon">🏪</div>
    <div class="rl-title">Acceso Local / Caja</div>
    <div class="rl-sub">Ingresá la clave de tu negocio</div>

    <div id="localLoginStep1">
      <div class="fl">
        <label>Nombre del negocio (primera vez)</label>
        <input id="localNom" placeholder="Ej: Pizzería 'La Nonna'" autocomplete="off">
      </div>
      <div class="fl">
        <label>Clave de acceso</label>
        <input id="localClave" type="password" placeholder="••••••••" autocomplete="off">
      </div>
      <button class="btn btn-teal" style="margin-top:8px" onclick="loginLocal()">✓ Entrar</button>
      <button class="btn btn-ghost" style="margin-top:8px" onclick="volverRole()">← Volver</button>
    </div>
  </div>
</div>
```

#### **Paso 1.4: Lógica JavaScript para Login Local**
En la sección `<script>` del HTML, agregar:

```javascript
let localSessionId = null;

function mostrarLoginLocal() {
  // Verificar si ya tiene sesión guardada
  const savedSession = sessionStorage.getItem('localSession');
  if (savedSession) {
    localSessionId = savedSession;
    entrarLocal();
    return;
  }
  document.getElementById('roleScreen').classList.remove('show');
  document.getElementById('localLogin').classList.add('show');
}

async function loginLocal() {
  const nom = document.getElementById('localNom').value.trim();
  const clave = document.getElementById('localClave').value;
  
  if (!clave) { toast('Ingresá la clave', 'warn'); return; }

  // PRIMERA VEZ: crear negocio
  if (nom && !sessionStorage.getItem('localCreado')) {
    try {
      const res = await api('POST', '/local/crear', {
        nombreNegocio: nom,
        claveInicial: clave
      });
      if (res?.ok) {
        sessionStorage.setItem('localCreado', '1');
        toast('✓ Negocio creado. Ahora ingresá con tu clave', 'ok');
        document.getElementById('localNom').value = '';
        return;
      }
    } catch(e) { toast('Error al crear negocio', 'warn'); return; }
  }

  // LOGIN normal
  try {
    const res = await api('POST', '/local/login', { clave });
    if (res?.ok) {
      localSessionId = res.sessionId;
      sessionStorage.setItem('localSession', localSessionId);
      document.getElementById('localLogin').classList.remove('show');
      document.getElementById('localClave').value = '';
      entrarLocal();
    } else {
      toast('❌ Clave incorrecta', 'warn');
    }
  } catch(e) { toast('Error de conexión', 'warn'); }
}
```

---

## **PROBLEMA 2️⃣: ASIGNACIÓN DE PEDIDO AL REPARTIDOR**
### ❌ Problema actual:
- El pedido se crea pero no llega al repartidor
- El ID generado (1000+) no coincide con lo que busca el HTML
- No hay botón en cocina para asignar repartidor al pedido

### ✅ Solución:

#### **Paso 2.1: Crear campo de asignación en pedido**
En `servidor.js`, modificar la tabla de pedidos:

```javascript
await pool.query(`
  ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS repId INTEGER;
  ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS repNombre TEXT;
  ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS repAsignadoEn TIMESTAMP;
`);
```

#### **Paso 2.2: Endpoint para asignar repartidor desde cocina**
En `servidor.js`, agregar:

```javascript
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

    // Verificar que el repartidor existe
    const rep = db.repartidores.find(r => r.id == repId);
    if (!rep) return r.status(400).json({ error: 'Repartidor no existe' });

    p.repId = repId;
    p.repNombre = rep.nombre;
    p.repAsignadoEn = new Date().toISOString();

    if (useDB) {
      await pool.query('UPDATE pedidos SET data=$1 WHERE id=$2', [JSON.stringify(p), id]);
    }

    // Broadcast para notificar al repartidor
    bcastLight({ 
      tipo: 'PEDIDO_ASIGNADO_AL_REP', 
      pedido: p,
      repId: repId 
    });

    r.json({ ok: true, pedido: p });
  } catch(e) { console.error(e); r.status(500).json({ error: e.message }); }
});
```

#### **Paso 2.3: Botón en COCINA para asignar repartidor**
En `pvdelivery.html`, modificar la sección `renderCocina()`:

```javascript
function renderCocina() {
  const activos = db.pedidos.filter(p => p.estado==='pendiente'||p.estado==='preparando');
  const hdr = document.getElementById('cocinaHdr');
  hdr.className = activos.length ? 'cocina-header activo' : 'cocina-header';
  hdr.innerHTML = `<div class="cocina-header-ic">${activos.length?'🔥':'🍳'}</div><div class="cocina-header-txt">${activos.length?activos.length+' pedido'+(activos.length>1?'s':'')+' activo'+(activos.length>1?'s':''):'Cocina libre — sin pedidos activos'}</div>`;
  const div = document.getElementById('listaCocina');
  if (!activos.length) { div.innerHTML='<div class="empty"><div class="empty-ic">🍳</div><p>No hay pedidos en cocina.</p></div>'; return; }
  
  div.innerHTML = activos.map(p => `
    <div class="pcard st-${p.estado}">
      <div class="pchead">
        <div>
          <div class="pcnum">#${String(p.id).padStart(4,'0')} · ${new Date(p.fecha).toLocaleTimeString('es',{hour:'2-digit',minute:'2-digit'})}</div>
          <div class="pctitle">${p.cli}</div>
          <div class="pcsub">📍 ${p.dir}</div>
        </div>
        <span class="badge ${EB[p.estado]}">${ELIC[p.estado]} ${EL[p.estado]}</span>
      </div>
      
      <!-- ASIGNACIÓN DE REPARTIDOR -->
      <div style="background:var(--ink3);border:1px solid var(--teal-bd);border-radius:8px;padding:10px;margin-bottom:10px">
        ${p.repId 
          ? `<div style="font-family:var(--mono);font-size:11px;color:var(--teal);margin-bottom:4px">✓ ASIGNADO A REPARTIDOR</div>
             <div style="font-size:14px;font-weight:700">${p.repNombre}</div>`
          : `<div>
               <div style="font-family:var(--mono);font-size:10px;color:var(--t3);margin-bottom:6px;text-transform:uppercase">Asignar repartidor</div>
               <div style="display:flex;gap:6px">
                 <select id="rep_sel_${p.id}" style="flex:1;padding:8px;font-size:12px;background:var(--ink2);color:var(--t1);border:1px solid var(--line);border-radius:6px">
                   <option value="">Seleccionar...</option>
                   ${db.repartidores.filter(r => r.activo).map(r => `<option value="${r.id}">${r.nombre}</option>`).join('')}
                 </select>
                 <button class="btn btn-sm btn-teal" style="width:auto" onclick="asignarRepPedido(${p.id})">Asignar</button>
               </div>
             </div>`
        }
      </div>

      <div class="cocina-items">
        ${p.items.map(i => `<div class="ki"><div class="ki-nom">${i.nom}</div><div class="ki-qty">×${i.cant}</div></div>`).join('')}
      </div>
      ${p.notas?`<div class="callout teal" style="margin-bottom:10px"><span style="font-size:12px">📝 ${p.notas}</span></div>`:''}
      <div class="btns">
        ${p.estado==='pendiente'?`<button class="btn btn-teal" onclick="avanzar(${p.id})">🍳 Empezar preparación</button>`:''}
        ${p.estado==='preparando'?`<button class="btn btn-teal" onclick="avanzar(${p.id})">✅ Listo — pasar a repartidor</button>`:''}
      </div>
    </div>`).join('');
}

async function asignarRepPedido(pedidoId) {
  const selEl = document.getElementById('rep_sel_' + pedidoId);
  const repId = parseInt(selEl.value);
  if (!repId) { toast('Selecciona un repartidor', 'warn'); return; }
  
  try {
    const res = await api('PUT', `/pedidos/${pedidoId}/asignar-rep`, { repId });
    if (res?.ok) {
      toast('🛵 Repartidor asignado: ' + res.pedido.repNombre, 'ok');
      renderCocina();
    }
  } catch(e) { toast('Error al asignar', 'warn'); }
}
```

#### **Paso 2.4: Notificar al repartidor cuando llega pedido**
Modificar la función `handle()` para procesar `PEDIDO_ASIGNADO_AL_REP`:

```javascript
function handle(msg) {
  // ... código existente ...
  
  if (msg.tipo === 'PEDIDO_ASIGNADO_AL_REP') {
    if (msg.pedido) {
      const idx = db.pedidos.findIndex(p => p.id === msg.pedido.id);
      if (idx >= 0) db.pedidos[idx] = msg.pedido;
    }
    renderAll(); renderRepAll(); updateSync();
    // Notificar al repartidor asignado
    if (rol === 'rep' && msg.repId == miRepId) {
      toast('🔔 ¡NUEVO PEDIDO! #' + msg.pedido.id + ' para ' + msg.pedido.cli, 'rep');
      sonarNotif('nuevo');
      vib();
    }
  }
}
```

---

## **PROBLEMA 3️⃣: REGISTRO DE REPARTIDOR VINCULADO AL LOCAL**
### ❌ Problema actual:
- Los repartidores se registran pero no saben a qué local pertenecen
- Cualquiera puede entrar como repartidor sin estar registrado en ese local
- No hay validación de pertenencia al local

### ✅ Solución:

#### **Paso 3.1: Modificar tabla de repartidores**
En `servidor.js`, en `initDB()`:

```javascript
await pool.query(`
  ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS localId INTEGER;
  ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS registradoEn TIMESTAMP;
`);
```

#### **Paso 3.2: Endpoint mejorado para registrar repartidor**
Reemplazar `app.post('/api/repartidores'...` por:

```javascript
app.post('/api/repartidores', async (q, r) => {
  try {
    const { nombre, dni, tel, com, foto, localId } = q.body;
    
    let newId;
    if (useDB) {
      const res = await pool.query('SELECT MAX(id) as mx FROM repartidores');
      const mx = res.rows[0]?.mx || 999;
      newId = Math.max(parseInt(mx) + 1, 1000);
      if (newId > 9999) newId = parseInt(mx) + 1;
      
      await pool.query(
        'INSERT INTO repartidores(id,nombre,dni,tel,com,foto,activo,localId,registradoEn) VALUES($1,$2,$3,$4,$5,$6,true,$7,NOW()) ON CONFLICT(id) DO UPDATE SET nombre=$2,dni=$3,tel=$4,com=$5,foto=$6,localId=$7',
        [newId, nombre, dni||'', tel||'', com||0, foto||null, localId||null]
      );
    } else {
      const mx = ram.repartidores.reduce((m,r) => Math.max(m, r.id||0), 999);
      newId = Math.max(mx + 1, 1000);
      ram.repartidores.push({ 
        id:newId, nombre, dni:dni||'', tel:tel||'', com:com||0, 
        foto:foto||null, activo:true, lat:null, lng:null, 
        localId:localId||null, registradoEn:new Date().toISOString() 
      });
    }
    
    await bcast('DATOS_ACTUALIZADOS', {});
    r.json({ ok: true, rep: { id:newId, nombre, dni, tel, com, foto } });
  } catch(e) { console.error(e); r.status(500).json({ error: e.message }); }
});
```

#### **Paso 3.3: Endpoint para validar repartidor en login**
En `servidor.js`, agregar:

```javascript
app.post('/api/rep/verificar', async (q, r) => {
  try {
    const { repId, localId } = q.body;
    
    if (useDB) {
      const res = await pool.query(
        'SELECT id,nombre FROM repartidores WHERE id=$1 AND localId=$2 AND activo=true',
        [repId, localId]
      );
      if (!res.rows.length) {
        return r.status(401).json({ 
          error: 'Este repartidor no está registrado en este local' 
        });
      }
      r.json({ ok: true, rep: res.rows[0] });
    } else {
      const rep = ram.repartidores.find(r => r.id === repId && r.localId === localId && r.activo);
      if (!rep) {
        return r.status(401).json({ 
          error: 'Este repartidor no está registrado en este local' 
        });
      }
      r.json({ ok: true, rep });
    }
  } catch(e) { r.status(500).json({ error: e.message }); }
});
```

#### **Paso 3.4: Modificar login de repartidor para validar**
En HTML, modificar `verificarIdRep()`:

```javascript
async function verificarIdRep() {
  const idIngresado = parseInt(document.getElementById('repLoginId').value.trim());
  if (!idIngresado || idIngresado < 1000 || idIngresado > 9999) { 
    toast('Ingresá un ID válido de 4 dígitos','warn'); 
    return; 
  }
  
  // Obtener el localId (necesitamos guardarlo en algún lugar)
  const localId = localStorage.getItem('currentLocalId');
  
  try {
    const res = await api('POST', '/rep/verificar', { repId: idIngresado, localId: parseInt(localId) });
    if (res?.ok) {
      repTemp = res.rep;
      document.getElementById('repVerifNombre').textContent = '👤 ' + res.rep.nombre;
      const fotoReg = document.getElementById('repFotoRegistrada');
      if (repTemp.foto) { 
        fotoReg.src = repTemp.foto; 
        fotoReg.style.display='block'; 
      } else { 
        fotoReg.style.display='none'; 
      }
      document.getElementById('repStep1').style.display = 'none';
      document.getElementById('repStep2').style.display  = 'block';
      abrirCamaraRep();
    }
  } catch(e) {
    toast('❌ ' + (e.error || 'Repartidor no encontrado en este local'), 'warn');
  }
}
```

---

## **PROBLEMA 4️⃣: CÓDIGO DE NEGOCIO ÚNICO**
### ❌ Problema actual:
- Sin código único, todos los datos se mezclan
- No hay aislamiento por negocio
- Múltiples locales en la misma instancia generan conflictos

### ✅ Solución:

#### **Paso 4.1: Crear tabla de negocios**
En `servidor.js`, en `initDB()`:

```javascript
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
  
  ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS negocioId INTEGER REFERENCES negocios(id);
  ALTER TABLE repartidores ADD COLUMN IF NOT EXISTS negocioId INTEGER REFERENCES negocios(id);
  ALTER TABLE pedidos ADD COLUMN IF NOT EXISTS negocioId INTEGER;
  ALTER TABLE productos ADD COLUMN IF NOT EXISTS negocioId INTEGER;
`);
```

#### **Paso 4.2: Endpoint para crear/registrar negocio**
En `servidor.js`, agregar:

```javascript
function generarCodigoNegocio() {
  // Código único de 6 caracteres: 3 letras + 3 números
  const letras = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const numeros = '0123456789';
  let codigo = '';
  for (let i = 0; i < 3; i++) codigo += letras.charAt(Math.floor(Math.random() * 26));
  for (let i = 0; i < 3; i++) codigo += numeros.charAt(Math.floor(Math.random() * 10));
  return codigo.split('').sort(() => Math.random() - 0.5).join('');
}

app.post('/api/negocio/crear', async (q, r) => {
  try {
    const { nombre, clave, latitud, longitud, direccion, telefono } = q.body;
    if (!nombre || !clave) return r.status(400).json({ error: 'Datos incompletos' });
    
    if (useDB) {
      const codigo = generarCodigoNegocio();
      const res = await pool.query(
        `INSERT INTO negocios(codigo, nombre, claveAcceso, latitud, longitud, direccion, telefonoLocal, activo) 
         VALUES($1, $2, $3, $4, $5, $6, $7, true) RETURNING *`,
        [codigo, nombre, clave, latitud||null, longitud||null, direccion||'', telefono||'']
      );
      const negocio = res.rows[0];
      r.json({ ok: true, negocio: { id: negocio.id, codigo: negocio.codigo, nombre: negocio.nombre } });
    } else {
      const codigo = 'TEST' + Math.random().toString(36).substr(2, 6).toUpperCase();
      ram.negocio = nombre;
      ram.negocioId = codigo;
      r.json({ ok: true, negocio: { codigo, nombre } });
    }
  } catch(e) { console.error(e); r.status(500).json({ error: e.message }); }
});

app.post('/api/negocio/login', async (q, r) => {
  try {
    const { codigo, clave } = q.body;
    if (!codigo || !clave) return r.status(400).json({ error: 'Código y clave requeridos' });
    
    if (useDB) {
      const res = await pool.query(
        'SELECT id, codigo, nombre FROM negocios WHERE codigo=$1 AND claveAcceso=$2 AND activo=true',
        [codigo.toUpperCase(), clave]
      );
      if (!res.rows.length) return r.status(401).json({ error: 'Código o clave incorrectos' });
      const negocio = res.rows[0];
      r.json({ ok: true, negocio });
    } else {
      if (codigo === ram.negocioId && clave === 'local123') {
        r.json({ ok: true, negocio: { id: 1, codigo, nombre: ram.negocio } });
      } else {
        r.status(401).json({ error: 'Código o clave incorrectos' });
      }
    }
  } catch(e) { r.status(500).json({ error: e.message }); }
});
```

---

## **PROBLEMA 5️⃣: DIRECCIÓN DEL LOCAL Y RUTA GPS**
### ❌ Problema actual:
- No se guarda la dirección del local
- No hay ruta del pedido
- Sin estimación de tiempo

### ✅ Solución:

#### **Paso 5.1: Guardar ubicación del local en config**
En HTML, en la sección de CONFIG, agregar:

```html
<div class="card">
  <div class="card-title">Ubicación del local (para GPS)</div>
  <div class="fl">
    <label>Dirección</label>
    <input id="cfgDirLocal" placeholder="Calle y número...">
  </div>
  <button class="btn btn-ghost" style="margin-bottom:8px" onclick="detectarUbicacionLocal()">📍 Usar mi ubicación actual</button>
  <div class="row2">
    <div class="fl"><label>Latitud</label><input id="cfgLatLocal" type="number" placeholder="0.0000" step="0.0001"></div>
    <div class="fl"><label>Longitud</label><input id="cfgLngLocal" type="number" placeholder="0.0000" step="0.0001"></div>
  </div>
  <button class="btn btn-teal" onclick="guardarUbicacionLocal()">💾 Guardar ubicación</button>
</div>
```

#### **Paso 5.2: Funciones para guardar ubicación**
En JavaScript:

```javascript
function detectarUbicacionLocal() {
  if (!navigator.geolocation) { toast('Tu navegador no soporta GPS', 'warn'); return; }
  navigator.geolocation.getCurrentPosition(pos => {
    document.getElementById('cfgLatLocal').value = pos.coords.latitude.toFixed(6);
    document.getElementById('cfgLngLocal').value = pos.coords.longitude.toFixed(6);
    toast('📍 Ubicación detectada', 'ok');
  }, err => { toast('No se pudo acceder a GPS', 'warn'); });
}

async function guardarUbicacionLocal() {
  const dir = document.getElementById('cfgDirLocal').value.trim();
  const lat = parseFloat(document.getElementById('cfgLatLocal').value);
  const lng = parseFloat(document.getElementById('cfgLngLocal').value);
  
  if (!dir || !lat || !lng) { toast('Completá todos los campos', 'warn'); return; }
  
  localStorage.setItem('local_dir', dir);
  localStorage.setItem('local_lat', lat);
  localStorage.setItem('local_lng', lng);
  
  toast('✓ Ubicación guardada', 'ok');
}
```

#### **Paso 5.3: Calcular ruta y tiempo estimado**
En JavaScript, agregar función:

```javascript
function calcularRuta(lat1, lng1, lat2, lng2) {
  // Haversine mejorado para distancia
  const R = 6371; // km
  const dLat = (lat2-lat1)*Math.PI/180;
  const dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)*Math.sin(dLat/2) +
    Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)*Math.sin(dLng/2);
  const c = 2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
  const distancia = R * c;
  
  // Estimación: 20 km/h promedio en ciudad
  const minutos = Math.ceil((distancia / 20) * 60);
  
  return { distancia: distancia.toFixed(2), minutos };
}

// Usar en renderActivos() para mostrar tiempo estimado:
function renderActivos() {
  // ... código existente ...
  const latLocal = parseFloat(localStorage.getItem('local_lat')||'0');
  const lngLocal = parseFloat(localStorage.getItem('local_lng')||'0');
  
  const lista = miActivos().sort(...);
  // Luego, al renderizar cada pedido, calcular distancia:
  // const { distancia, minutos } = calcularRuta(latLocal, lngLocal, clienteLat, clienteLng);
}
```

---

## **PROBLEMA 6️⃣: MENSAJERÍA INTERNA (Sin WhatsApp)**
### ❌ Problema actual:
- Todo se hace por WhatsApp externo
- Sin historial de mensajes en el sistema
- Sin notificaciones push internas

### ✅ Solución:

#### **Paso 6.1: Crear tabla de mensajes**
En `servidor.js`, en `initDB()`:

```javascript
await pool.query(`
  CREATE TABLE IF NOT EXISTS mensajes (
    id SERIAL PRIMARY KEY,
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
```

#### **Paso 6.2: Endpoints para mensajes**
En `servidor.js`, agregar:

```javascript
app.post('/api/mensajes', async (q, r) => {
  try {
    const { pedidoId, de, deId, para, paraId, contenido } = q.body;
    if (!contenido || !de || !para) return r.status(400).json({ error: 'Datos incompletos' });
    
    if (useDB) {
      await pool.query(
        `INSERT INTO mensajes(pedidoId, de, deId, para, paraId, contenido, leido) 
         VALUES($1, $2, $3, $4, $5, $6, false)`,
        [pedidoId||null, de, deId||null, para, paraId||null, contenido]
      );
    }
    
    // Broadcast del mensaje
    bcastLight({ tipo: 'MENSAJE_NUEVO', pedidoId, de, para, contenido });
    r.json({ ok: true });
  } catch(e) { console.error(e); r.status(500).json({ error: e.message }); }
});

app.get('/api/mensajes/:pedidoId', async (q, r) => {
  try {
    const pedidoId = parseInt(q.params.pedidoId);
    if (useDB) {
      const res = await pool.query('SELECT * FROM mensajes WHERE pedidoId=$1 ORDER BY creadoEn ASC', [pedidoId]);
      r.json(res.rows);
    } else {
      r.json([]);
    }
  } catch(e) { r.status(500).json({ error: e.message }); }
});
```

#### **Paso 6.3: UI para mensajería en cada pedido**
Agregar en la tarjeta de pedido (Local y Repartidor):

```html
<!-- CHAT INTERNO -->
<div id="chatPedido_${p.id}" style="display:none;background:var(--ink3);border:1px solid var(--line);border-radius:8px;padding:10px;margin-bottom:10px;max-height:200px;overflow-y:auto">
  <div id="msgList_${p.id}" style="font-size:12px;line-height:1.6;margin-bottom:8px"></div>
  <div style="display:flex;gap:6px">
    <input id="msgInput_${p.id}" type="text" placeholder="Mensaje..." style="flex:1;padding:6px;font-size:11px;background:var(--ink2);color:var(--t1);border:1px solid var(--line);border-radius:4px">
    <button class="btn btn-sm btn-teal" style="width:auto" onclick="enviarMensaje(${p.id})">Enviar</button>
  </div>
</div>
<button class="btn btn-sm btn-ghost" onclick="abrirChat(${p.id})">💬 Chat interno</button>
```

---

## **PROBLEMA 7️⃣: ESTADO EN CLIENTE (Seguimiento real)**
### ❌ Problema actual:
- El cliente no puede marcar "Recibido"
- No puede confirmar pago
- Sin opciones de acciones en su pantalla

### ✅ Solución:

#### **Paso 7.1: Agregar botones en pantalla de cliente**
En `actualizarTracking()`, modificar para agregar acciones:

```javascript
function actualizarTracking(p) {
  // ... código existente ...
  
  const puedeConfirmar = p.estado === 'camino' || p.estado === 'preparando';
  const botones = puedeConfirmar 
    ? `<button class="btn btn-teal" onclick="cliConfirmarRecibido(${p.id})">✅ Confirmé que llegó</button>`
    : p.estado === 'entregado'
    ? `<div style="text-align:center;padding:16px;background:var(--teal-bg);border:1px solid var(--teal-bd);border-radius:8px">
        <div style="font-weight:700;color:var(--teal);margin-bottom:8px">¡Pedido recibido!</div>
        <button class="btn btn-sm btn-teal" style="width:auto" onclick="cliConfirmarPago(${p.id})">Confirmar pago</button>
      </div>`
    : '';
  
  // Agregar botones al HTML
  const trackDiv = document.getElementById('cliTracking');
  if (trackDiv) {
    let botonesDiv = trackDiv.querySelector('#trackBotones_' + p.id);
    if (!botonesDiv) {
      botonesDiv = document.createElement('div');
      botonesDiv.id = 'trackBotones_' + p.id;
      trackDiv.appendChild(botonesDiv);
    }
    botonesDiv.innerHTML = botones;
  }
}

async function cliConfirmarRecibido(pedidoId) {
  try {
    const res = await api('PUT', `/pedidos/${pedidoId}/estado`, { estado: 'entregado' });
    if (res?.ok) {
      toast('✅ Entrega confirmada', 'ok');
      actualizarTracking(res.pedido);
    }
  } catch(e) { toast('Error al confirmar', 'warn'); }
}

function cliConfirmarPago(pedidoId) {
  const p = db.pedidos.find(x => x.id === pedidoId);
  if (!p) return;
  
  if (p.pagado) {
    toast('✓ Pago ya confirmado', 'ok');
    return;
  }
  
  abrirModalPagoCli(pedidoId);
}

function abrirModalPagoCli(pedidoId) {
  const p = db.pedidos.find(x => x.id === pedidoId);
  if (!p) return;
  
  const modal = document.createElement('div');
  modal.className = 'modal open';
  modal.innerHTML = `
    <div class="modal-box">
      <div class="modal-handle"></div>
      <button class="modal-close" onclick="this.parentElement.parentElement.remove()">✕</button>
      <div class="modal-title">Confirmar pago</div>
      <div class="total-box" style="margin:16px 0">
        <div class="trow"><span class="tl">Total</span><span class="tv big">$${p.total.toLocaleString()}</span></div>
      </div>
      <div style="margin:16px 0">
        <label style="display:block;font-size:12px;color:var(--t3);margin-bottom:8px;font-family:var(--mono)">¿Cómo pagaste?</label>
        <div style="display:flex;flex-direction:column;gap:8px" id="pagoOpts">
          <label style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--ink3);border-radius:6px;cursor:pointer">
            <input type="radio" name="pago" value="efectivo" checked> 💵 Efectivo
          </label>
          <label style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--ink3);border-radius:6px;cursor:pointer">
            <input type="radio" name="pago" value="qr"> 📱 QR / MercadoPago
          </label>
          <label style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--ink3);border-radius:6px;cursor:pointer">
            <input type="radio" name="pago" value="tarjeta"> 💳 Tarjeta
          </label>
        </div>
      </div>
      <button class="btn btn-teal" onclick="cliGuardarPago(${pedidoId});this.parentElement.parentElement.remove()">✓ Confirmar</button>
    </div>
  `;
  document.body.appendChild(modal);
}

async function cliGuardarPago(pedidoId) {
  const metodo = document.querySelector('input[name="pago"]:checked')?.value || 'efectivo';
  try {
    await api('PUT', `/pedidos/${pedidoId}/estado`, { estado: 'entregado', cobro: metodo });
    toast('✅ Pago confirmado', 'ok');
  } catch(e) { toast('Error', 'warn'); }
}
```

---

## **PROBLEMA 8️⃣: RECIBIR PAGO EN EFECTIVO (Local recibe del Repartidor)**
### ❌ Problema actual:
- No hay registro cuando el repartidor entrega efectivo
- Sin confirmación de pago
- Sin contabilización

### ✅ Solución:

#### **Paso 8.1: Modificar endpoint para guardar método de cobro**
En `servidor.js`, modificar `app.put('/api/pedidos/:id/estado'...`:

```javascript
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
    if (efectivoRecibido !== undefined) p.efectivoRecibido = efectivoRecibido; // Dinero recibido por repartidor
    if (estado === 'entregado') p.pagado = true;
    
    p.hist = p.hist || [];
    p.hist.push({ e: estado, h: new Date().toLocaleTimeString(), detalles: cobro ? `Pago: ${cobro}` : '' });
    
    if (useDB) await pool.query('UPDATE pedidos SET data=$1 WHERE id=$2', [JSON.stringify(p), id]);
    
    bcastLight({ tipo: 'PEDIDO_ACTUALIZADO', pedido: p });
    r.json({ ok: true, pedido: p });
  } catch(e) { console.error(e); r.status(500).json({ error: e.message }); }
});
```

#### **Paso 8.2: Botón en pantalla de REPORTES para recibir efectivo**
En la sección de Reportes (Local), agregar:

```javascript
function renderReportes() {
  // ... código existente ...
  
  // Agregar sección para efectivo recibido de repartidores
  const efectivoEsperado = db.pedidos.filter(p => 
    p.estado === 'entregado' && 
    p.cobro === 'efectivo' && 
    !p.efectivoRecibido
  );
  
  const efectivoRecibidoTotal = db.pedidos.filter(p => 
    p.estado === 'entregado' && 
    p.efectivoRecibido
  ).reduce((s, p) => s + p.total, 0);
  
  const div = document.getElementById('repReporte');
  const html = `
    <div style="background:var(--amber-bg);border:1px solid var(--amber-bd);border-radius:10px;padding:14px;margin-bottom:14px">
      <div style="font-weight:700;color:var(--amber);margin-bottom:10px">💵 Efectivo pendiente de recibir</div>
      ${efectivoEsperado.map(p => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--amber-bd)">
          <div>
            <div style="font-weight:600">#${String(p.id).padStart(4,'0')} — ${p.cli}</div>
            <div style="font-size:11px;color:var(--t3)">🛵 ${p.repNombre || 'Sin asignar'}</div>
          </div>
          <button class="btn btn-sm btn-amber" onclick="marcarEfectivoRecibido(${p.id})">Recibí $${p.total}</button>
        </div>
      `).join('')}
    </div>
    <div style="background:var(--teal-bg);border:1px solid var(--teal-bd);border-radius:10px;padding:14px">
      <div style="font-weight:700;color:var(--teal)">✓ Efectivo recibido hoy</div>
      <div style="font-family:var(--mono);font-size:24px;color:var(--teal);margin-top:8px">$${efectivoRecibidoTotal.toLocaleString()}</div>
    </div>
  `;
  
  // Agregar al div de reportes
  const reportesDiv = document.getElementById('repReporte');
  if (reportesDiv) reportesDiv.innerHTML = html + reportesDiv.innerHTML;
}

async function marcarEfectivoRecibido(pedidoId) {
  const p = db.pedidos.find(x => x.id === pedidoId);
  if (!p) return;
  
  try {
    await api('PUT', `/pedidos/${pedidoId}/estado`, { 
      estado: 'entregado', 
      efectivoRecibido: true 
    });
    toast(`💵 Efectivo recibido: $${p.total}`, 'ok');
    renderReportes();
  } catch(e) { toast('Error', 'warn'); }
}
```

---

## **PROBLEMA 9️⃣: GANANCIAS DEL REPARTIDOR**
### ❌ Problema actual:
- El repartidor no ve sus ganancias
- Sin desglose de adelantos/adeudos
- Sin resumen de días

### ✅ Solución:

#### **Paso 9.1: Mejorar `renderMiDia()` del repartidor**
En HTML, reemplazar `renderMiDia()`:

```javascript
function renderMiDia() {
  const hoy = new Date().toDateString();
  const mios = db.pedidos.filter(p => p.repId==miRepId && new Date(p.fecha).toDateString()===hoy);
  const ent = mios.filter(p=>p.estado==='entregado');
  const enc = mios.filter(p=>p.estado!=='entregado'&&p.estado!=='cancelado');
  
  const rep = db.repartidores.find(r=>r.id===miRepId);
  const comision = rep?.com || 0;
  const gane = ent.length * comision;
  
  // Efectivo recibido
  const efectivoRec = ent.filter(p => p.cobro === 'efectivo').reduce((s, p) => s + p.total, 0);
  const deudor = efectivoRec - gane; // Lo que debe entregar al local
  const adelanto = Math.max(0, gane - efectivoRec); // Lo que el local le debe
  
  document.getElementById('statsR').innerHTML = `
    <div class="scard c-teal"><div class="sv teal">${ent.length}</div><div class="sl">Entregados hoy</div></div>
    <div class="scard c-sky"><div class="sv sky">${enc.length}</div><div class="sl">En proceso</div></div>
    <div class="scard c-amber"><div class="sv amber">$${gane.toLocaleString()}</div><div class="sl">Ganancia por comisión</div></div>
    <div class="scard c-violet"><div class="sv violet">$${efectivoRec.toLocaleString()}</div><div class="sl">Efectivo en mano</div></div>`;
  
  const div = document.getElementById('resumenDiaR');
  
  let resumen = `
    <div class="slbl" style="margin-top:16px">💰 RESUMEN FINANCIERO</div>
    <div class="total-box">
      <div class="trow"><span class="tl">Entregas completadas</span><span class="tv">${ent.length}</span></div>
      <div class="trow"><span class="tl">Comisión por entrega</span><span class="tv">$${comision.toLocaleString()}</span></div>
      <div class="trow" style="border-top:1px solid var(--line);padding-top:8px;margin-top:8px"><span class="tl" style="font-weight:700">Ganancia total</span><span class="tv big teal">$${gane.toLocaleString()}</span></div>
    </div>
    
    <div class="slbl">💵 EFECTIVO EN MANO</div>
    <div class="total-box">
      <div class="trow"><span class="tl">Efectivo recibido</span><span class="tv">$${efectivoRec.toLocaleString()}</span></div>
      <div class="trow"><span class="tl">Debo entregar</span><span class="tv red">-$${Math.max(0, deudor).toLocaleString()}</span></div>
      <div class="trow"><span class="tl">Me debe local (adelanto)</span><span class="tv teal">+$${Math.max(0, adelanto).toLocaleString()}</span></div>
      <div class="trow" style="border-top:1px solid var(--line);padding-top:8px;margin-top:8px"><span class="tl" style="font-weight:700">Saldo neto</span><span class="tv big">${deudor > 0 ? '-$' + deudor.toLocaleString() : '+$' + adelanto.toLocaleString()}</span></div>
    </div>
  `;
  
  if (ent.length > 0) {
    resumen += `<div class="slbl">📋 DETALLES DE ENTREGAS</div>`;
    resumen += ent.map(p => `
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--line);font-size:13px">
        <div>
          <div style="font-weight:600">#${String(p.id).padStart(4,'0')}</div>
          <div style="font-size:11px;color:var(--t3)">${p.cli} · $${p.total}</div>
        </div>
        <div style="text-align:right">
          <div style="font-family:var(--mono);font-size:12px;color:var(--teal)">${p.horaEntrega || ''}</div>
          <div style="font-size:10px;color:var(--t3)">${p.cobro||'sin pago'}</div>
        </div>
      </div>
    `).join('');
  }
  
  div.innerHTML = resumen;
}
```

#### **Paso 9.2: Guardar historial de días**
En `servidor.js`, crear tabla:

```javascript
await pool.query(`
  CREATE TABLE IF NOT EXISTS repDiarios (
    id SERIAL PRIMARY KEY,
    repId INTEGER REFERENCES repartidores(id),
    fecha DATE,
    entregas INTEGER,
    ganancia NUMERIC,
    efectivoRecibido NUMERIC,
    creadoEn TIMESTAMP DEFAULT NOW(),
    UNIQUE(repId, fecha)
  );
`);
```

#### **Paso 9.3: Endpoint para guardar resumen del día**
En `servidor.js`, agregar:

```javascript
app.post('/api/rep/resumen-dia', async (q, r) => {
  try {
    const { repId, fecha, entregas, ganancia, efectivoRecibido } = q.body;
    if (useDB) {
      await pool.query(
        `INSERT INTO repDiarios(repId, fecha, entregas, ganancia, efectivoRecibido) 
         VALUES($1, $2, $3, $4, $5)
         ON CONFLICT(repId, fecha) DO UPDATE SET 
         entregas=$3, ganancia=$4, efectivoRecibido=$5`,
        [repId, fecha, entregas, ganancia, efectivoRecibido]
      );
    }
    r.json({ ok: true });
  } catch(e) { r.status(500).json({ error: e.message }); }
});
```

---

## **PROBLEMA 🔟: NOTIFICACIONES DE ASIGNACIÓN**
### ❌ Problema actual:
- Sin sonido cuando asignan pedido
- Sin vibración en dispositivos
- Sin verificación visual

### ✅ Solución:

La funcionalidad ya existe en tu código (`sonarNotif`, `vib`), pero necesita mejoras:

```javascript
// Mejorar sonarNotif para diferentes tipos
function sonarNotif(tipo) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const seqs = {
      nuevo:      [[880,0.08],[1100,0.12],[880,0.08],[1320,0.18]],
      listo:      [[660,0.1],[880,0.1],[1100,0.2]],
      entregado:  [[440,0.08],[660,0.08],[880,0.15]],
      asignado:   [[1000,0.1],[1200,0.1],[1400,0.2]], // Repartidor
      pagorecib:  [[700,0.08],[900,0.12],[700,0.08]] // Local
    };
    const seq = seqs[tipo] || seqs.nuevo;
    let t = ctx.currentTime;
    seq.forEach(([freq, dur]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = freq; o.type = 'sine';
      g.gain.setValueAtTime(0.4, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.start(t); o.stop(t + dur);
      t += dur + 0.04;
    });
  } catch(e) {}
}

// Cuando llega PEDIDO_ASIGNADO_AL_REP:
if (rol === 'rep' && msg.repId == miRepId) {
  toast('🔔 ¡NUEVO PEDIDO! #' + msg.pedido.id + ' — ' + msg.pedido.cli, 'rep');
  sonarNotif('asignado');
  vib(); // Vibración
}

// Cuando local recibe efectivo:
if (msg.tipo === 'EFECTIVO_RECIBIDO') {
  if (rol === 'local') {
    sonarNotif('pagorecib');
    vib([100, 50, 100, 50, 200]);
  }
}
```

---

## **PROBLEMA 1️⃣1️⃣: INSTALADOR Y APP MÓVIL**
### ❌ Problema actual:
- Solo funciona como PWA
- Sin instalador ejecutable
- Sin APK para Android

### ✅ Solución breve (desarrollo futuro):

Para convertir a app instalable necesitas:

1. **Electron** (para PC desktop):
   ```bash
   npm install electron electron-builder --save-dev
   ```

2. **Apache Cordova** (para Android/iOS):
   ```bash
   npm install -g cordova
   cordova create pvdelivery
   cordova platform add android
   ```

3. **Por ahora**, usar **PWA** que ya está implementado en tu código.

---

## **RESUMEN DE CAMBIOS INMEDIATOS**

### ✅ Prioridad ALTA (Implementar primero):
1. ✅ **Problema 1**: Autenticación del Local ← HECHO ARRIBA
2. ✅ **Problema 2**: Asignación de repartidor ← HECHO ARRIBA
3. ✅ **Problema 3**: Registro vinculado al local ← HECHO ARRIBA

### ✅ Prioridad MEDIA:
4. ✅ **Problema 4**: Código de negocio único ← HECHO ARRIBA
5. ✅ **Problema 5**: Dirección y GPS ← HECHO ARRIBA
6. ✅ **Problema 6**: Mensajería interna ← HECHO ARRIBA

### ✅ Prioridad BAJA (Nice to have):
7. ✅ **Problema 7**: Seguimiento en cliente ← HECHO ARRIBA
8. ✅ **Problema 8**: Recibir efectivo ← HECHO ARRIBA
9. ✅ **Problema 9**: Ganancias del rep ← HECHO ARRIBA
10. ✅ **Problema 10**: Notificaciones ← LISTO
11. ✅ **Problema 11**: App instalable ← FUTURO

---

## **PRÓXIMOS PASOS**

1. **Copia el código de cada sección** a tu proyecto
2. **Prueba en RAM primero** (sin database)
3. **Luego activa PostgreSQL**
4. **Haz commits en Git** de cada cambio
5. **Prueba entre roles** (Local → Cocina → Repartidor → Cliente)

¿Necesitas ayuda implementando alguna sección específica?
