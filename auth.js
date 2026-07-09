// ============================================================
// IFFYWARE SYSTEMS — auth.js
// Módulo de autenticación: hash de PINs, JWT, rate limiting.
// ============================================================
const bcrypt   = require('bcryptjs');
const jwt      = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');

// JWT_SECRET: si no está definida, se genera una al arrancar.
// OJO: si el proceso se reinicia sin JWT_SECRET fija en las variables
// de entorno del hosting, todas las sesiones activas se invalidan.
// Definila en Render/Railway para que sea estable entre despliegues.
const crypto = require('crypto');
const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString('hex');
if (!process.env.JWT_SECRET) {
  console.warn('[AUTH] JWT_SECRET no definida — se generó una temporal. ' +
               'Las sesiones se invalidan en cada reinicio. Definí JWT_SECRET en las variables de entorno.');
}

const TOKEN_TTL = '12h';

function hashPin(pin) {
  return bcrypt.hashSync(String(pin), 10);
}

function verificarPin(pinPlano, hashGuardado) {
  // Compatibilidad con datos viejos: si el valor guardado no es un hash
  // bcrypt (no empieza con $2), se compara texto plano UNA vez y se
  // devuelve una bandera para que el caller lo re-hashee.
  if (typeof hashGuardado === 'string' && hashGuardado.startsWith('$2')) {
    return { ok: bcrypt.compareSync(String(pinPlano), hashGuardado), necesitaRehash: false };
  }
  const ok = String(pinPlano) === String(hashGuardado);
  return { ok, necesitaRehash: ok };
}

function firmarToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function verificarToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch (e) { return null; }
}

// Middleware: exige un token válido. Uso: requireAuth() o requireAuth('admin')
function requireAuth(rolMinimo) {
  const jerarquia = { operador: 1, cajero: 1, cocinero: 1, gerente: 2, admin: 3 };
  return (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ ok: false, error: 'Token requerido' });
    const data = verificarToken(token);
    if (!data) return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });
    if (rolMinimo) {
      const nivelReq = jerarquia[rolMinimo] || 99;
      const nivelUsr = jerarquia[data.rol] || 0;
      if (nivelUsr < nivelReq) return res.status(403).json({ ok: false, error: 'Permiso insuficiente' });
    }
    req.auth = data;
    next();
  };
}

// Rate limit para endpoints de login: 5 intentos cada 15 min por IP.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiados intentos. Probá de nuevo en 15 minutos.' }
});

// Rate limit general para toda la API: 300 req/min por IP.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiadas solicitudes, esperá un momento.' }
});

module.exports = { hashPin, verificarPin, firmarToken, verificarToken, requireAuth, loginLimiter, apiLimiter };
