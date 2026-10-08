// Página de estado del correo diario, y envío de prueba.
//   /.netlify/functions/correo-diario-estado            → estado, audiencias y próximos correos
//   /.netlify/functions/correo-diario-estado?prueba=1   → manda el próximo correo SOLO al email de prueba

import { ahoraMadrid, correoDelDia, proximos, titulo, mailchimp, config as ajustes } from '../lib/correo-diario.mjs';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function pagina(cuerpo) {
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Correo diario</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#111}h1{font-size:20px}h2{font-size:16px;margin-top:28px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px 4px;text-align:left;vertical-align:top}.ok{color:#0a7a3d}.no{color:#b3261e}code{background:#f2f2f2;padding:1px 4px;border-radius:3px}</style></head><body>${cuerpo}</body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export default async (req) => {
  const ahora = ahoraMadrid();
  const url = new URL(req.url);
  const mc = mailchimp();

  if (url.searchParams.get('prueba')) {
    const correo = correoDelDia(ahora.fecha) || proximos(ahora.fecha, 1)[0];
    if (!correo) return pagina('<h1>Prueba</h1><p class="no">No hay correos en la cola.</p>');
    const listId = ajustes.listaGeneralId || process.env.MAILCHIMP_LIST_ID;
    try {
      // Freno: como mucho una prueba cada 10 minutos
      const recientes = await mc.llamar('GET', `/campaigns?count=10&sort_field=create_time&sort_dir=DESC&list_id=${listId}&fields=campaigns.settings.title,campaigns.create_time`);
      const ultima = recientes.campaigns.find(c => (c.settings.title || '').endsWith('(prueba)'));
      if (ultima && Date.now() - new Date(ultima.create_time).getTime() < 10 * 60 * 1000) {
        return pagina('<h1>Prueba</h1><p class="no">Ya se mandó una prueba hace menos de 10 minutos. Espera un poco.</p>');
      }
      const id = await mc.crearCampania(listId, correo, { tituloExtra: ' (prueba)' });
      await mc.llamar('POST', `/campaigns/${id}/actions/test`, { test_emails: [ajustes.emailPrueba], send_type: 'plaintext' });
      return pagina(`<h1>Prueba enviada</h1><p class="ok">El correo ${correo.id}, "${esc(correo.asunto)}", se ha mandado solo a ${esc(ajustes.emailPrueba)}.</p><p>No se ha enviado nada a ninguna lista.</p>`);
    } catch (err) {
      console.error(err);
      return pagina(`<h1>Prueba</h1><p class="no">Error: ${esc(err.message)}</p>`);
    }
  }

  // Envío inmediato del correo de hoy a la lista (solo por POST, desde el botón de esta página)
  if (req.method === 'POST' && url.searchParams.get('enviar') === 'hoy') {
    if (!ajustes.activo || !ajustes.listaGeneralId) return pagina('<h1>Enviar ahora</h1><p class="no">El envío está desactivado o falta la audiencia general.</p>');
    const correo = correoDelDia(ahora.fecha);
    if (!correo) return pagina('<h1>Enviar ahora</h1><p class="no">No hay correo para hoy en la cola.</p>');
    try {
      const yaEnviado = (await mc.diariosRecientes(ajustes.listaGeneralId)).find(c => c.titulo === titulo(correo) && c.estado !== 'save');
      if (yaEnviado) return pagina(`<h1>Enviar ahora</h1><p class="no">El correo de hoy ya se envió (${esc(yaEnviado.estado)}). No se repite.</p>`);
      const id = await mc.crearCampania(ajustes.listaGeneralId, correo);
      await mc.llamar('POST', `/campaigns/${id}/actions/send`);
      console.log(`[correo-diario-estado] Enviado ahora el correo ${correo.id} (campaña ${id})`);
      return pagina(`<h1>Enviado</h1><p class="ok">El correo ${correo.id}, "${esc(correo.asunto)}", se está enviando a tu lista.</p><p>A las 16:10 no se repetirá.</p>`);
    } catch (err) {
      console.error(err);
      return pagina(`<h1>Enviar ahora</h1><p class="no">Error: ${esc(err.message)}</p>`);
    }
  }

  let audiencias = [], recientes = [], error = '';
  try {
    audiencias = await mc.audiencias();
    if (ajustes.listaGeneralId) recientes = await mc.diariosRecientes(ajustes.listaGeneralId);
  } catch (err) {
    error = err.message;
  }

  const hoy = correoDelDia(ahora.fecha);
  const filasAud = audiencias.map(a => `<tr><td>${esc(a.nombre)}${a.id === ajustes.listaGeneralId ? ' <b>(la del correo diario)</b>' : ''}</td><td><code>${esc(a.id)}</code></td><td>${a.suscriptores}</td></tr>`).join('');
  const filasProx = proximos(ahora.fecha, 5).map(c => `<tr><td>${c.fecha}</td><td>${esc(c.asunto)}</td></tr>`).join('');
  const filasEnv = recientes.filter(c => !c.titulo.endsWith('(prueba)')).slice(0, 10).map(c => `<tr><td>${esc(c.titulo)}</td><td>${esc(c.estado)}</td></tr>`).join('');

  return pagina(`
<h1>Correo diario</h1>
<p>Hoy en Madrid: <b>${ahora.fecha}</b>. Envío a las ${ajustes.horaEnvioMadrid}:${String(ajustes.minutoEnvioMadrid).padStart(2,'0')} de lunes a viernes.</p>
<p>Estado: ${ajustes.activo ? '<b class="ok">ACTIVO</b>' : '<b class="no">DESACTIVADO</b> (no se envía nada a la lista)'}</p>
<p>Correo de hoy: ${hoy ? `${hoy.id} · "${esc(hoy.asunto)}"` : '<span class="no">ninguno</span>'}</p>
${error ? `<p class="no">Error con Mailchimp: ${esc(error)}</p>` : ''}
<h2>Próximos correos</h2><table><tr><th>Fecha</th><th>Asunto</th></tr>${filasProx || '<tr><td colspan="2" class="no">La cola está vacía</td></tr>'}</table>
<h2>Audiencias de Mailchimp</h2><table><tr><th>Nombre</th><th>Id</th><th>Suscriptores</th></tr>${filasAud}</table>
<h2>Últimos envíos</h2><table><tr><th>Campaña</th><th>Estado</th></tr>${filasEnv || '<tr><td colspan="2">Todavía ninguno</td></tr>'}</table>
<p><a href="?prueba=1">Mandarme el próximo correo como prueba</a> (solo a ${esc(ajustes.emailPrueba)})</p>
${ajustes.activo && ajustes.listaGeneralId && hoy && !recientes.some(c => c.titulo === titulo(hoy) && c.estado !== 'save')
  ? `<form method="post" action="?enviar=hoy" onsubmit="return confirm('¿Enviar ya el correo de hoy a toda la lista?')"><button style="font-size:15px;padding:8px 14px;margin-top:8px">Enviar ya el correo de hoy a toda la lista</button></form>`
  : ''}`);
};
