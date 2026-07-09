# PVDelivery — Instaladores Windows y Android

Ambos instaladores se compilan en GitHub Actions (la nube), no en tu
mini-laptop. Vos solo subís código y descargás el resultado.

## Windows (.exe)

1. En GitHub → pestaña **Actions** → workflow **"Build instalador Windows"** → **Run workflow**.
2. Esperá ~3-5 minutos.
3. Entrá a la corrida terminada → sección **Artifacts** → descargá `PVDelivery-Windows-Installer`.
4. Adentro hay un `.exe` — ese es el instalador. Doble clic en la PC del cliente, instala como cualquier programa de Windows.

Qué hace el `.exe` instalado: abre una ventana de escritorio que levanta el
mismo `servidor.js` en `localhost` y muestra `pvdelivery.html` — funciona
sin necesitar Render/Railway, ideal para un local con PC propia y sin
depender de internet para el POS interno (Mercado Pago sigue necesitando
conexión para cobrar).

Para generar una nueva versión: subís los cambios al repo, corrés el
workflow de nuevo. Cada corrida genera un instalador nuevo.

## Android (.apk)

Más laborioso porque un APK "de verdad" (no solo PWA instalable desde el
navegador) requiere firmar el paquete y verificar el dominio.

1. **Requisito previo**: el sistema tiene que estar desplegado y accesible
   por HTTPS (Render/Railway ya cumplen esto).
2. En GitHub → **Settings → Secrets and variables → Actions → Variables** →
   crear `PWA_URL` con la URL del cliente, ej: `https://mi-cliente.onrender.com`
3. **Actions** → workflow **"Build APK Android (TWA)"** → **Run workflow**.
4. Primera corrida: bubblewrap genera un keystore (certificado de firma)
   nuevo. Se descarga junto al APK en los artifacts. **Guardalo en un lugar
   seguro fuera de GitHub** — sin ese archivo no podés sacar actualizaciones
   del mismo APK más adelante, tenés que volver a instalar desde cero en
   todos los celulares.
5. El mismo paso final del workflow imprime un **SHA256 fingerprint**.
   Copialo y agregalo como variable de entorno `ANDROID_ASSETLINKS_JSON`
   en Render/Railway (ver `.env.example`) — sin esto el APK abre con la
   barra de direcciones del navegador visible, como una PWA cualquiera.
6. Corré el workflow una segunda vez para que el APK final quede verificado
   contra ese fingerprint.

Para reutilizar el mismo keystore en compilaciones futuras (necesario para
publicar actualizaciones): subilo como secret `ANDROID_KEYSTORE_B64`
(el archivo en base64) y descomentá el paso "Restaurar keystore existente"
en `.github/workflows/build-android.yml`.

## Modelo multi-cliente

Como cada cliente es una instancia separada (Render + Supabase propios, ver
`README-deploy.md`), cada uno necesita su propio build de Android (con su
propia `PWA_URL`) si querés darle un APK. El instalador de Windows, en
cambio, corre el servidor localmente — no depende de qué cliente sea, así
que un mismo `.exe` sirve de plantilla para cualquiera (cada local configura
su propio `.env` en la PC donde lo instala).
