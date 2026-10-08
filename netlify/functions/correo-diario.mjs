// Envío automático del correo diario a la audiencia general de Mailchimp.
// Se ejecuta de lunes a viernes a las 5:15 y 6:15 UTC; solo envía en la ejecución que cae
// a las 7:xx de Madrid (así funciona igual en horario de verano y de invierno).

import { ahoraMadrid, correoDelDia, titulo, mailchimp, config as ajustes } from '../lib/correo-diario.mjs';

export default async () => {
  const ahora = ahoraMadrid();
  const registrar = (msg) => { console.log(`[correo-diario ${ahora.fecha} ${ahora.hora}h] ${msg}`); return new Response(msg); };

  if (ahora.hora !== ajustes.horaEnvioMadrid) return registrar('No es la hora de envío en Madrid. Nada que hacer.');
  if (!ajustes.activo) return registrar('Envío desactivado en correos/config.mjs. No se envía nada.');
  if (!ajustes.listaGeneralId) return registrar('ERROR: falta listaGeneralId en correos/config.mjs.');

  const correo = correoDelDia(ahora.fecha);
  if (!correo) return registrar('AVISO: no hay correo en la cola para hoy. No se envía nada.');

  try {
    const mc = mailchimp();
    const recientes = await mc.diariosRecientes(ajustes.listaGeneralId);
    const yaEnviado = recientes.find(c => c.titulo === titulo(correo) && c.estado !== 'save');
    if (yaEnviado) return registrar(`El correo ${correo.id} ya se envió (${yaEnviado.estado}). No se repite.`);

    const id = await mc.crearCampania(ajustes.listaGeneralId, correo);
    await mc.llamar('POST', `/campaigns/${id}/actions/send`);
    return registrar(`Enviado el correo ${correo.id}: "${correo.asunto}" (campaña ${id}).`);
  } catch (err) {
    console.error(err);
    return registrar(`ERROR al enviar el correo ${correo.id}: ${err.message}`);
  }
};

export const config = {
  schedule: '15 5,6 * * 1-5'
};
