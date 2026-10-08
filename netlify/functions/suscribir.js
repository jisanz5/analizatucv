const crypto = require('crypto');

// Apunta al usuario a la lista solo si ha marcado la casilla de consentimiento,
// guarda su puntuación, nivel y sector como etiquetas en Mailchimp y, si existe
// la variable MAKE_WEBHOOK_URL, manda también los datos a Make.
// Nunca se envía ni se guarda el texto del CV.

const ORIGENES_PERMITIDOS = [
  'https://analizatucvya.netlify.app',
  'https://www.estoybuscandotrabajo.com',
  'https://estoybuscandotrabajo.com'
];

const NIVELES = ['junior', 'mid-senior', 'directivo'];

function cabeceras(origin) {
  const permitido = ORIGENES_PERMITIDOS.includes(origin) ? origin : ORIGENES_PERMITIDOS[0];
  return {
    'Access-Control-Allow-Origin': permitido,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
    'Vary': 'Origin'
  };
}

function origenValido(origin) {
  return !origin
    || ORIGENES_PERMITIDOS.includes(origin)
    || /^https:\/\/[a-z0-9-]+--analizatucvya\.netlify\.app$/.test(origin);
}

function tramoScore(score) {
  if (score >= 75) return 'alto';
  if (score >= 50) return 'medio';
  return 'bajo';
}

function texto(valor, max) {
  return typeof valor === 'string' ? valor.trim().substring(0, max) : '';
}

const respuesta = (statusCode, headers, obj) => ({ statusCode, headers, body: JSON.stringify(obj) });

exports.handler = async (event) => {
  const origin = event.headers.origin || event.headers.Origin || '';
  const headers = cabeceras(origin);

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return respuesta(405, headers, { error: 'Method Not Allowed' });
  if (!origenValido(origin)) return respuesta(403, headers, { error: 'Origen no permitido' });

  let datos;
  try {
    datos = JSON.parse(event.body || '{}');
  } catch {
    return respuesta(400, headers, { error: 'Petición no válida' });
  }

  const email = texto(datos.email, 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return respuesta(400, headers, { error: 'Email no válido' });
  }
  if (datos.consentimiento !== true) {
    return respuesta(400, headers, { error: 'Falta el consentimiento' });
  }

  const score = Number.isFinite(Number(datos.score)) ? Math.max(0, Math.min(100, Math.round(Number(datos.score)))) : null;
  const nivel = NIVELES.includes(datos.nivel) ? datos.nivel : '';
  const sector = texto(datos.sector, 60);
  const problemas = Array.isArray(datos.problemas)
    ? datos.problemas.slice(0, 3).map(p => texto(p, 80)).filter(Boolean)
    : [];

  const etiquetas = ['Analizador-CV'];
  if (score !== null) etiquetas.push(`Score ${tramoScore(score)}`);
  if (nivel) etiquetas.push(`Nivel ${nivel}`);

  const apiKey = process.env.MAILCHIMP_API_KEY;
  const listId = process.env.MAILCHIMP_LIST_ID;
  if (!apiKey || !listId) {
    console.error('Faltan MAILCHIMP_API_KEY o MAILCHIMP_LIST_ID');
    return respuesta(500, headers, { error: 'Configuración incompleta' });
  }

  try {
    const dc = apiKey.split('-').pop();
    const auth = 'Basic ' + Buffer.from(`anystring:${apiKey}`).toString('base64');
    const hash = crypto.createHash('md5').update(email).digest('hex');
    const base = `https://${dc}.api.mailchimp.com/3.0/lists/${listId}/members/${hash}`;

    // Crea o actualiza el contacto. Si alguien se dio de baja antes, no lo volvemos a dar de alta a la fuerza:
    // Mailchimp le pedirá confirmar de nuevo.
    const alta = await fetch(base, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ email_address: email, status_if_new: 'subscribed' })
    });
    if (!alta.ok) {
      const err = await alta.json().catch(() => ({}));
      console.error('Error de Mailchimp (alta)', alta.status, err.title, err.detail);
      return respuesta(502, headers, { error: 'No se pudo completar la suscripción' });
    }

    // Las etiquetas se añaden aparte: en un PUT, Mailchimp las ignora si el contacto ya existía
    const tags = await fetch(`${base}/tags`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({ tags: etiquetas.map(name => ({ name, status: 'active' })) })
    });
    if (!tags.ok) console.error('Error de Mailchimp (etiquetas)', tags.status);
  } catch (err) {
    console.error('Fallo al suscribir', err);
    return respuesta(500, headers, { error: 'Error interno' });
  }

  // Envío a Make (opcional). Si falla, la suscripción ya está hecha y no molestamos al usuario.
  const webhook = process.env.MAKE_WEBHOOK_URL;
  if (webhook) {
    try {
      await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          score,
          tramo_score: score !== null ? tramoScore(score) : '',
          nivel,
          sector,
          problemas,
          consentimiento_comercial: true,
          texto_consentimiento: texto(datos.texto_consentimiento, 300),
          origen: 'analizador-cv',
          fecha: new Date().toISOString()
        })
      });
    } catch (err) {
      console.error('Fallo al enviar a Make', err);
    }
  }

  return respuesta(200, headers, { success: true });
};
