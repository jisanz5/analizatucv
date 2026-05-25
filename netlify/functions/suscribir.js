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

    const url = `https://${dc}.api.mailchimp.com/3.0/lists/${listId}/members`;

    const payload = {
      email_address: email,
      status: 'subscribed',
      tags: ['Analizador-CV']
    };

    if (score !== undefined) {
      payload.merge_fields = { SCORE: String(score) };
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${credentials}`
      },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    // 200 = nuevo suscriptor, 400 con Member Exists = ya estaba suscrito (ambos OK)
    if (response.ok || (response.status === 400 && data.title === 'Member Exists')) {
      return {
        statusCode: 200,
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: JSON.stringify({ success: true })
      };
    }

    // Cualquier otro error de Mailchimp
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
