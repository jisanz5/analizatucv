// Página de estado del correo diario, envío de prueba y envío inmediato.
//   GET  /.netlify/functions/correo-diario-estado              → estado, audiencias y próximos correos
//   GET  /.netlify/functions/correo-diario-estado?prueba=1     → manda el correo de hoy (o el próximo) SOLO al email de prueba
//   POST /.netlify/functions/correo-diario-estado?enviar=hoy   → manda ya el correo de hoy a las audiencias (botón de la página)

import { ahoraMadrid, correoDelDia, proximos, titulo, mailchimp, listasDestino, enviarATodas, config as ajustes } from '../lib/correo-diario.mjs';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function pagina(cuerpo) {
  return new Response(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Correo diario</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px;color:#111}h1{font-size:20px}h2{font-size:16px;margin-top:28px}table{border-collapse:collapse;width:100%}td,th{border-bottom:1px solid #ddd;padding:6px 4px;text-align:left;vertical-align:top}.ok{color:#0a7a3d}.no{color:#b3261e}code{background:#f2f2f2;padding:1px 4px;border-radius:3px}button{font-size:15px;padding:8px 14px;margin-top:8px;cursor:pointer}</style></head><body>${cuerpo}<p style="margin-top:28px"><a href="?">Volver al estado</a></p></body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export default async (req) => {
  const ahora = ahoraMadrid();
  const url = new URL(req.url);
  const mc = mailchimp();

  if (url.searchParams.get('prueba')) {
    const correo = correoDelDia(ahora.fecha) || proximos(ahora.fecha, 1)[0];
    if (!correo) return pagina('<h1>Prueba</h1><p class="no">No hay correos en la cola.</p>');
    try {
      const listId = (await listasDestino(mc))[0] || process.env.MAILCHIMP_LIST_ID;
      // Freno: como mucho una prueba cada 10 minutos
      const recientes = await mc.llamar('GET', `/campaigns?count=10&sort_field=create_time&sort_dir=DESC&list_id=${listId}&fields=campaigns.settings.title,campaigns.create_time`);
      const ultima = recientes.campaigns.find(c => (c.settings.title || '').endsWith('(prueba)'));
      if (ultima && Date.now() - new Date(ultima.create_time).getTime() < 10 * 60 * 1000) {
        return pagina('<h1>Prueba</h1><p class="no">Ya se mandó una prueba hace menos de 10 minutos. Espera un poco.</p>');
      }
      const id = await mc.crearCampania(listId, correo, { tituloExtra: ' (prueba)' });
      await mc.llamar('POST', `/campaigns/${id}/actions/test`, { test_emails: [ajustes.emailPrueba], send_type: 'plaintext' });
      return pagina(`<h1>Prueba enviada</h1><p class="ok">El correo ${correo.id}, "${esc(correo.asunto)}", se ha mandado solo a ${esc(ajustes.emailPrueba)}.</p><p>No se ha enviado nada a ninguna audiencia.</p>`);
    } catch (err) {
      console.error(err);
      return pagina(`<h1>Prueba</h1><p class="no">Error: ${esc(err.message)}</p>`);
    }
  }

  if (req.method === 'POST' && url.searchParams.get('enviar') === 'hoy') {
    if (!ajustes.activo) return pagina('<h1>Enviar ahora</h1><p class="no">El envío está desactivado.</p>');
    const correo = correoDelDia(ahora.fecha);
    if (!correo) return pagina('<h1>Enviar ahora</h1><p class="no">No hay correo para hoy en la cola.</p>');
    const resultados = await enviarATodas(mc, correo);
    console.log(`[correo-diario-estado] Envío inmediato del correo ${correo.id}: ${resultados.join(' | ')}`);
    return pagina(`<h1>Envío del correo de hoy</h1><p>"${esc(correo.asunto)}"</p><ul>${resultados.map(r => `<li class="${r.includes('ERROR') ? 'no' : 'ok'}">${esc(r)}</li>`).join('')}</ul><p>A las 16:10 no se repetirá en las audiencias donde ya salió.</p>`);
  }

  let audiencias = [], destino = [], enviadosHoy = 0, error = '';
  const hoy = correoDelDia(ahora.fecha);
  try {
    audiencias = await mc.audiencias();
    destino = await listasDestino(mc);
    if (hoy) {
      for (const listId of destino) {
        const r = await mc.diariosRecientes(listId);
        if (r.some(c => c.titulo === titulo(hoy) && c.estado !== 'save')) enviadosHoy++;
      }
    }
  } catch (err) {
    error = err.message;
  }

  const filasAud = audiencias.map(a => `<tr><td>${esc(a.nombre)}</td><td><code>${esc(a.id)}</code></td><td>${a.suscriptores}</td><td>${destino.includes(a.id) ? '<span class="ok">sí</span>' : 'no'}</td></tr>`).join('');
  const filasProx = proximos(ahora.fecha, 6).map(c => `<tr><td>${c.fecha}</td><td>${esc(c.asunto)}</td></tr>`).join('');
  const pendienteHoy = ajustes.activo && hoy && destino.length && enviadosHoy < destino.length;

  return pagina(`
<h1>Correo diario</h1>
<p>Hoy en Madrid: <b>${ahora.fecha}</b>. Envío automático a las ${ajustes.horaEnvioMadrid}:${String(ajustes.minutoEnvioMadrid).padStart(2, '0')} de lunes a viernes.</p>
<p>Estado: ${ajustes.activo ? '<b class="ok">ACTIVO</b>' : '<b class="no">DESACTIVADO</b> (no se envía nada)'}</p>
<p>Correo de hoy: ${hoy ? `${hoy.id} · "${esc(hoy.asunto)}" — enviado en ${enviadosHoy} de ${destino.length} audiencias` : '<span class="no">ninguno</span>'}</p>
${error ? `<p class="no">Error con Mailchimp: ${esc(error)}</p>` : ''}
${pendienteHoy ? `<form method="post" action="?enviar=hoy" onsubmit="return confirm('¿Enviar ya el correo de hoy a todas las audiencias marcadas?')"><button>Enviar ya el correo de hoy</button></form>` : ''}
<p><a href="?prueba=1">Mandarme el correo como prueba</a> (solo a ${esc(ajustes.emailPrueba)})</p>
<h2>Próximos correos</h2><table><tr><th>Fecha</th><th>Asunto</th></tr>${filasProx || '<tr><td colspan="2" class="no">La cola está vacía</td></tr>'}</table>
<h2>Audiencias de Mailchimp</h2><table><tr><th>Nombre</th><th>Id</th><th>Suscriptores</th><th>Recibe el diario</th></tr>${filasAud}</table>`);
};
