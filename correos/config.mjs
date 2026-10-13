// Ajustes del correo diario.
// activo: mientras sea false, no se envía nada a ninguna audiencia.
// audiencias: 'todas' manda el correo a todas las audiencias de Mailchimp (una campaña por audiencia);
//             también puede ser una lista de ids concretos, por ejemplo ['03436f5b5b'].

export default {
  activo: true,
  audiencias: 'todas',
  remitente: 'Jesús Ignacio',
  responderA: 'jesus@estoybuscandotrabajo.com',
  emailPrueba: 'jesusignacio@saanz.es',
  horaEnvioMadrid: 16,
  minutoEnvioMadrid: 10
};
