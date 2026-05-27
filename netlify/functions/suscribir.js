const crypto = require('crypto');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { email, score } = JSON.parse(event.body);

    const apiKey = process.env.MAILCHIMP_API_KEY;
    const listId = process.env.MAILCHIMP_LIST_ID;

    if (!apiKey || !listId) {
      return {
        statusCode: 500,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ error: 'Missing configuration' })
      };
    }

    const dc = apiKey.split('-').pop();
    const credentials = Buffer.from(`anystring:${apiKey}`).toString('base64');

    // PUT con el hash MD5 del email — permite crear o actualizar sin error de duplicado
    const emailHash = crypto.createHash('md5').update(email.toLowerCase()).digest('hex');
    const url = `https://${dc}.api.mailchimp.com/3.0/lists/${listId}/members/${emailHash}`;

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${credentials}`
      },
      body: JSON.stringify({
        email_address: email,
        status_if_new: 'subscribed',
        status: 'subscribed',
        tags: ['Analizador-CV']
      })
    });

    const data = await response.json();

    if (response.ok) {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: true })
      };
    }

    return {
      statusCode: 400,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: data.detail || data.title || 'Mailchimp error' })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
