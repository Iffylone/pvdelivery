# 📋 REQUISITOS FUNCIONALES - Iffyware Systems v3.0

## 🎯 ROLES Y FLUJOS

### 1️⃣ **CLIENTE**
- ✅ **Registro/Login**: Formulario inicial con datos personales
- ✅ **Historial**: Ver pedidos anteriores
- ✅ **Hacer pedido**: Menú, seleccionar productos, checkout
- ✅ **Tracking en tiempo real**: Mapa con ruta del repartidor (NO solo estados)
- ✅ **Chat**: Comunicación con local (sin salir del app)
- ❌ **NO debe poder cerrar/salir** del sistema

### 2️⃣ **REPARTIDOR (Rider)**
- ✅ **Login**: ID + Selfie vs foto registrada
- ✅ **Mi bandeja**: Pedidos asignados por caja
- ✅ **Ruta con GPS**: Visualizar recorrido (cliente → destino)
  - Distancia en KM
  - Dirección completa (calle, número, piso, depto, letra)
  - Estimado de tiempo
- ✅ **Tracking en vivo**: Su ubicación actualiza en tiempo real
- ✅ **Chat**: Contactar local si no encuentra cliente
- ✅ **Confirmación de entrega**: Foto o firma
- ✅ **Mi ganancia**: Monto que le corresponde por ese pedido (comisión)
  - Diferencia: precio local ≠ precio rider
- ✅ **Historial diario**: Pedidos entregados, totales ganados
- ❌ **NO debe poder cerrar/salir** del sistema

### 3️⃣ **CAJA/LOCAL**
- ✅ **Dashboard**: Resumen del día (pedidos, ingresos, etc.)
- ✅ **Nuevo pedido**: Crear manualmente o recibir del cliente
- ✅ **Asignar rider**: De lista de repartidores registrados
- ✅ **Estado del pedido**: Pendiente → Cocina → Listo → En camino → Entregado
- ✅ **Cocina notifica "Listo"**: La caja ve que está listo para asignar a rider
- ✅ **Chat con rider**: Si hay problema con entrega
- ✅ **Resumen diario**: Guardado automático (pueda ver día anterior)
- ✅ **Productos agotados**: Marcar como no disponibles
- ✅ **Cerrar sesión**: Al terminar jornada
- ✅ **Próxima sesión**: Datos del día anterior precargados

### 4️⃣ **COCINA**
- ✅ **Panel en vivo**: Pedidos por hacer (cola)
- ✅ **Marcar "Listo"**: Notifica a caja (NO asigna rider)
- ✅ **Cantidad de items por pedido**: Visible claramente
- ✅ **Historial de preparación**: Qué se hizo hoy

---

## 🗺️ FLUJO DE UN PEDIDO

### Cliente crea pedido:
1. Cliente completa formulario (nombre, tel, dirección)
2. Elige productos
3. Caja recibe notificación
4. Caja → Cocina envía a preparar
5. Cocina marca "Listo" → Caja ve que está listo
6. **Caja asigna rider** (de lista registrada)
7. Rider recibe en su app: **RUTA CON GPS**
   - Desde: Local
   - Hasta: Dirección cliente
   - Distancia en KM
   - ETA
8. **Cliente ve en tiempo real** dónde está el rider (mapa)
9. Rider confirma entrega (foto/firma)
10. Sistema calcula ganancia rider (comisión)

### Problema: Rider no encuentra cliente
- Rider envía **chat** a local
- Local responde con indicaciones
- Si es devolver al local: Rider gana igualmente (comisión se paga)

---

## 💾 PERSISTENCIA DE DATOS

### Sesión Caja/Local:
- Al abrir nuevo día: **Carga resumen del día anterior**
  - Pedidos entregados
  - Total ingresos
  - Total comisiones pagadas
  - Productos más vendidos
- Permite comparar: hoy vs ayer

### Cliente:
- **Historial completo** de pedidos (fecha, total, estado)

### Rider:
- **Historial diario**: Pedidos entregados, ganancias acumuladas

---

## 🎨 INTERFACES CLAVE

### 📱 Cliente - Home
```
[Formulario registro si es nuevo]
[Historial de pedidos]
[Botón: Hacer nuevo pedido]
[Tracking del pedido actual en tiempo real]
[Chat con local]
```

### 🛵 Rider - Home
```
[Mi ID + Foto]
[Bandeja: Pedidos asignados]
[Al abrir pedido: MAPA + RUTA]
  - Desde/Hasta
  - Distancia
  - ETA
[Chat con caja]
[Mis ganancias hoy]
[Historial de entregas]
```

### 🏪 Caja - Home
```
[Resumen: Pedidos hoy vs ayer]
[Botón: Nuevo pedido]
[Bandeja: Pendientes, en cocina, listos, en camino, entregados]
[Cuando está "Listo": Botón "Asignar rider"]
[Productos agotados: Marcar]
[Chat con riders]
[Al cerrar jornada: Guardar resumen]
```

### 👨‍🍳 Cocina - Home
```
[Cola de pedidos a hacer]
[Items por pedido]
[Botón: Marcar como "Listo"]
[Historial: Ya hechos hoy]
```

---

## 🔧 CAMBIOS TÉCNICOS NECESARIOS

### Backend (Node.js):
- ✅ Guardar historiales (BD o JSON por día)
- ✅ Rutas GPS (calcular distancia, ETA)
- ✅ Chat en tiempo real (WebSocket)
- ✅ Sesiones por usuario (cliente, rider, caja, cocina)
- ✅ Comisiones calculadas por pedido
- ✅ Marcar productos como "agotados"

### Frontend (HTML/JS):
- ✅ **Cliente**: Registro, historial, tracking con mapa
- ✅ **Rider**: Ruta con GPS, chat, ganancia por pedido
- ✅ **Caja**: Dashboard multi-día, asignación de riders
- ✅ **Cocina**: Panel de cola simplificado
- ✅ **Chat**: Integrado en cada rol
- ✅ **Logout bloqueado**: Excepto caja (sesión)

### Mapas:
- Usar **Leaflet.js + OpenStreetMap** (gratis, no requiere API key)
- O **Google Maps API** (requiere pago)

---

## 📊 PRIORIDADES DE DESARROLLO

1. **P1 - Crítico**: Login de cliente, registro, crear pedido
2. **P2 - Alto**: Sistema de sesiones, chat básico
3. **P3 - Alto**: Ruta GPS, tracking cliente
4. **P4 - Medio**: Historiales, resumen diario
5. **P5 - Medio**: Productos agotados, comisiones
6. **P6 - Bajo**: PWA (Android/iOS/PC)

---

## 📦 PRÓXIMAS FASES

### Fase 1 (Ahora): Core funcional
- Registros, login, flujo básico
- Chat simple
- GPS y rutas

### Fase 2: Historiales y reportes
- Guardado multi-día
- Resúmenes
- Exportación

### Fase 3: Optimización
- UI/UX pulida
- Performance
- Manejo de errores robusto

### Fase 4: Deployment
- PWA Android
- PWA iOS
- PWA Desktop
- Deploy en Vercel/Heroku/Railway

---

**Estado**: 🔴 **EN PLANIFICACIÓN**
**Próximo**: Crear estructura de BD y rutas del backend
