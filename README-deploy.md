# PVDelivery — Deploy multi-cliente desde un solo repo

## Modelo

```
GitHub repo (pvdelivery)
        │
        ├── Railway service → Cliente A (La Pizzería)
        ├── Railway service → Cliente B (El Burger)
        └── Railway service → Cliente C (Sushi House)
```

Un solo codebase. Cada cliente es un **servicio independiente** en Railway (o Render) con sus propias variables de entorno y su propia base de datos. Cuando pusheas al repo, Railway redespliega todos los servicios automáticamente.

---

## Setup inicial (una sola vez)

### 1. Subir el repo a GitHub

```bash
git init
git add .
git commit -m "init"
git remote add origin https://github.com/tu-usuario/pvdelivery.git
git push -u origin main
```

### 2. Crear el primer servicio en Railway

1. railway.app → New Project → Deploy from GitHub repo → seleccionar `pvdelivery`
2. En el servicio creado: **Settings → Source** → branch `main`
3. Agregar un add-on PostgreSQL (opcional pero recomendado para persistencia)
4. Ir a **Variables** y cargar las del cliente (ver tabla abajo)
5. Deploy

### 3. Segundo cliente (y siguientes)

1. En el mismo Railway project → **New Service → GitHub Repo** → mismo repo `pvdelivery`
2. Agregar otro add-on PostgreSQL separado (cada cliente tiene su propia DB)
3. Cargar las variables del nuevo cliente
4. Deploy

> Cada servicio comparte el código pero tiene su propia DB y sus propias variables. Son completamente aislados entre sí.

---

## Variables por cliente

| Variable | Requerida | Descripción |
|---|---|---|
| `NEGOCIO` | ✅ | Nombre del local |
| `CLAVE_OPERADOR` | ✅ | PIN de 4 dígitos para cajero |
| `CLAVE_ADMIN` | ✅ | PIN de 4 dígitos para admin |
| `DATABASE_URL` | Recomendada | PostgreSQL. Sin ella, datos en RAM |
| `MP_ACCESS_TOKEN` | Si usa MP | Token de Mercado Pago |
| `MP_PUBLIC_KEY` | Si usa MP | Public Key de Mercado Pago |
| `CBU_LOCAL` | Opcional | Para mostrar QR de cobro |
| `ALIAS_LOCAL` | Opcional | Alias del CBU |
| `DIR_LOCAL` | Opcional | Dirección del local |
| `CODIGO_LOCAL` | Opcional | Fijarlo evita que cambie entre reinicios en RAM |
| `COMISION_TIPO` | Opcional | `por_km` (default) o `fija` |
| `COMISION_POR_METRO` | Opcional | Default: `0.60` |
| `COMISION_FIJA` | Opcional | Default: `0` |
| `PRODUCTOS_DEFAULT` | Opcional | JSON array de productos iniciales |
| `PORT` | Auto | Railway lo asigna solo |

Ver `.env.example` para descripción completa de cada variable.

---

## Actualizar todos los clientes

```bash
git add .
git commit -m "fix: descripción del cambio"
git push
```

Railway detecta el push y redespliega todos los servicios automáticamente. El downtime por redeploy en Railway es ~10-20 segundos (rolling deploy).

---

## Desarrollo local

```bash
cp .env.example .env
# Editar .env con los valores del cliente a testear
npm install
npm run dev   # node --watch (hot reload)
```

Acceder en `http://localhost:3000`

---

## Estructura de archivos

```
pvdelivery/
├── servidor.js       ← backend Express + WebSockets + APIs
├── pvdelivery.html   ← frontend SPA (sirve desde el mismo servidor)
├── package.json
├── .env.example      ← template de variables (commitear esto, NO el .env)
├── .gitignore
└── README-deploy.md
```

---

## .gitignore mínimo

```
node_modules/
.env
*.log
```

---

## FAQ

**¿Qué pasa si dos clientes están en el mismo Railway project?**
No hay problema. Cada servicio es un proceso independiente con su propio puerto asignado por Railway, su propia DB y sus propias variables. No se interfieren.

**¿Se pueden poner en proyectos Railway separados?**
Sí. La ventaja de estar en el mismo proyecto es que es más fácil de administrar. La desventaja es ninguna.

**¿Si un cliente tiene datos en RAM y se redespliega, los pierde?**
Sí. Por eso `DATABASE_URL` es recomendada para producción. El add-on de PostgreSQL en Railway cuesta ~$5/mes por base de datos.

**¿Cómo dar acceso al cliente a sus variables sin que vea las de otros?**
Crear un Railway project por cliente (en lugar de un service dentro del mismo project). Así cada cliente puede tener su propio token de Railway con acceso solo a su proyecto.
