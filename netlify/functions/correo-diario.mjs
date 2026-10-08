// Envío automático del correo diario a las audiencias de Mailchimp.
// Se ejecuta de lunes a viernes a las 14:10 y 15:10 UTC; solo envía en la ejecución que cae
// a las 16:10 de Madrid (así funciona igual en horario de verano y de invierno).

import { ahoraMadrid, correoDelDia, mailchimp, enviarATodas, config as ajustes } from '../lib/correo-diario.mjs';

export default async () => {
  const ahora = ahoraMadrid();
  const registrar = (msg) => { console.log(`[correo-diario ${ahora.fecha} ${ahora.hora}h] ${msg}`); return new Response(msg); };

  if (ahora.hora !== ajustes.horaEnvioMadrid) return registrar('No es la hora de envío en Madrid. Nada que hacer.');
  if (!ajustes.activo) return registrar('Envío desactivado en correos/config.mjs. No se envía nada.');

  const correo = correoDelDia(ahora.fecha);
  if (!correo) return registrar('AVISO: no hay correo en la cola para hoy. No se envía nada.');

  try {
    const resultados = await enviarATodas(mailchimp(), correo);
    return registrar(`Correo ${correo.id} "${correo.asunto}": ${resultados.join(' | ') || 'no hay audiencias'}`);
  } catch (err) {
    console.error(err);
    return registrar(`ERROR al enviar el correo ${correo.id}: ${err.message}`);
  }
};

export const config = {
  schedule: '10 14,15 * * 1-5'
};
