// Lógica compartida del correo diario: fecha de Madrid, cola, y llamadas a Mailchimp.

import cola from '../../correos/cola.mjs';
import config from '../../correos/config.mjs';

export { cola, config };

export function ahoraMadrid(fecha = new Date()) {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Madrid',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', hour12: false, weekday: 'short'
    }).formatToParts(fecha).map(p => [p.type, p.value])
  );
  return {
    fecha: `${partes.year}-${partes.month}-${partes.day}`,
    hora: Number(partes.hour) % 24,
    diaSemana: partes.weekday // Mon, Tue...
  };
}

export function correoDelDia(fecha) {
  return cola.find(c => c.fecha === fecha) || null;
}

export function proximos(fecha, n = 3) {
  return cola.filter(c => c.fecha >= fecha).sort((a, b) => a.fecha.localeCompare(b.fecha)).slice(0, n);
}

export function titulo(correo) {
  return `Diario ${correo.fecha} · ${correo.id}`;
}

const WEB = 'https://www.estoybuscandotrabajo.com';
const LINKEDIN = 'https://www.linkedin.com/in/jisanz/';
const FIRMA_NOMBRE = 'Jesús Ignacio Sanz';

const escHtml = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Texto visible de un enlace: sin https://, sin www., sin barra final ni parámetros
function textoEnlace(url) {
  // Las páginas de acompañamiento 1 a 1 se muestran solo con el dominio (su dirección dice "mentoria")
  if (/\/mentoria-/.test(url)) return 'estoybuscandotrabajo.com';
  if (/calendar\.app\.google|calendly\.com/.test(url)) return 'mi agenda';
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/$/, '');
}

// Convierte las URLs de un párrafo en enlaces limpios
function enlazar(parrafo) {
  return escHtml(parrafo).replace(/https?:\/\/[^\s<]+/g, (url) => {
    const real = url.replace(/&amp;/g, '&');
    return `<a href="${escHtml(real)}" style="color:#1a56db">${escHtml(textoEnlace(real))}</a>`;
  });
}

// Párrafos del correo, quitando la firma "Jesús" (se pone la firma completa en su sitio)
function partes(correo) {
  const parrafos = correo.cuerpo.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  const i = parrafos.findIndex(p => p === 'Jesús' || p === FIRMA_NOMBRE);
  if (i === -1) return { antes: parrafos, despues: [] };
  return { antes: parrafos.slice(0, i), despues: parrafos.slice(i + 1) };
}

export function html(correo) {
  const { antes, despues } = partes(correo);
  const p = (t) => `<p style="margin:0 0 16px">${enlazar(t)}</p>`;
  const firma = `<p style="margin:24px 0 16px">${FIRMA_NOMBRE}<br><a href="${LINKEDIN}" style="color:#1a56db">LinkedIn</a> · <a href="${WEB}" style="color:#1a56db">estoybuscandotrabajo.com</a></p>`;
  const pie = `<p style="margin:40px 0 0;font-size:12px;line-height:1.5;color:#999">Recibes este correo porque te apuntaste en estoybuscandotrabajo.com. <a href="*|UNSUB|*" style="color:#999">Darte de baja</a>.<br>*|LIST:ADDRESSLINE|*</p>`;
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(correo.asunto)}</title></head>
<body style="margin:0;padding:0;background:#ffffff">
<div style="max-width:600px;margin:0 auto;padding:24px 20px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#222">
${antes.map(p).join('\n')}
${firma}
${despues.map(p).join('\n')}
${pie}
</div></body></html>`;
}

export function textoPlano(correo) {
  const { antes, despues } = partes(correo);
  return [...antes, `${FIRMA_NOMBRE}\nLinkedIn: ${LINKEDIN}\n${WEB}`, ...despues,
    `--\nRecibes este correo porque te apuntaste en estoybuscandotrabajo.com.\nDarte de baja: *|UNSUB|*`].join('\n\n');
}

// Ids de las audiencias a las que va el correo diario
export async function listasDestino(mc) {
  if (config.audiencias === 'todas') return (await mc.audiencias()).map(a => a.id);
  return Array.isArray(config.audiencias) ? config.audiencias : [];
}

// Envía el correo a cada audiencia destino, sin repetir en las que ya se envió.
// Devuelve una línea de resultado por audiencia.
export async function enviarATodas(mc, correo) {
  const resultados = [];
  for (const listId of await listasDestino(mc)) {
    try {
      const yaEnviado = (await mc.diariosRecientes(listId)).find(c => c.titulo === titulo(correo) && c.estado !== 'save');
      if (yaEnviado) { resultados.push(`${listId}: ya enviado antes (${yaEnviado.estado}), no se repite`); continue; }
      const id = await mc.crearCampania(listId, correo);
      await mc.llamar('POST', `/campaigns/${id}/actions/send`);
      resultados.push(`${listId}: enviado (campaña ${id})`);
    } catch (err) {
      console.error(err);
      resultados.push(`${listId}: ERROR ${err.message}`);
    }
  }
  return resultados;
}

export function mailchimp() {
  const apiKey = process.env.MAILCHIMP_API_KEY;
  if (!apiKey) throw new Error('Falta MAILCHIMP_API_KEY');
  const base = `https://${apiKey.split('-').pop()}.api.mailchimp.com/3.0`;
  const auth = 'Basic ' + Buffer.from(`anystring:${apiKey}`).toString('base64');

  async function llamar(metodo, ruta, cuerpo) {
    const res = await fetch(base + ruta, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined
    });
    const texto = await res.text();
    const datos = texto ? JSON.parse(texto) : {};
    if (!res.ok) throw new Error(`Mailchimp ${metodo} ${ruta}: ${res.status} ${datos.title || ''} ${datos.detail || ''}`.trim());
    return datos;
  }

  return {
    llamar,

    audiencias: async () => {
      const r = await llamar('GET', '/lists?count=50&fields=lists.id,lists.name,lists.stats.member_count');
      return r.lists.map(l => ({ id: l.id, nombre: l.name, suscriptores: l.stats.member_count }));
    },

    // Campañas recientes de una audiencia cuyo título empieza por "Diario "
    diariosRecientes: async (listId) => {
      const r = await llamar('GET', `/campaigns?count=50&sort_field=create_time&sort_dir=DESC&list_id=${listId}&fields=campaigns.id,campaigns.status,campaigns.settings.title,campaigns.send_time`);
      return r.campaigns
        .filter(c => (c.settings.title || '').startsWith('Diario '))
        .map(c => ({ id: c.id, titulo: c.settings.title, estado: c.status, enviado: c.send_time || null }));
    },

    crearCampania: async (listId, correo, { tituloExtra = '' } = {}) => {
      const c = await llamar('POST', '/campaigns', {
        type: 'regular',
        recipients: { list_id: listId },
        settings: {
          subject_line: correo.asunto,
          title: titulo(correo) + tituloExtra,
          from_name: config.remitente,
          reply_to: config.responderA
        },
        tracking: { opens: true, html_clicks: true, text_clicks: false }
      });
      await llamar('PUT', `/campaigns/${c.id}/content`, { html: html(correo), plain_text: textoPlano(correo) });
      return c.id;
    }
  };
}
