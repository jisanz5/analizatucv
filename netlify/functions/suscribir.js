exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { email, score } = JSON.parse(event.body);

    const apiKey = process.env.MAILCHIMP_API_KEY;
    const listId = process.env.MAILCHIMP_LIST_ID;
    const dc = apiKey.split('-')[1];

    const response = await fetch(`https://${dc}.api.mailchimp.com/3.0/lists/${listId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${Buffer.from(`anystring:${apiKey}`).toString('base64')}`
      },
      body: JSON.stringify({
        email_address: email,
        status: 'subscribed',
        merge_fields: {
          SCORE: String(score)
        },
        tags: ['Analizador-CV']
      })
    });

    // Si ya está suscrito (400 con title Member Exists), lo consideramos OK
    if (response.ok || response.status === 400) {
      const data = await response.json();
      if (response.ok || data.title === 'Member Exists') {
        return {
          statusCode: 200,
          headers: { 'Access-Control-Allow-Origin': '*' },
          body: JSON.stringify({ success: true })
        };
      }
      throw new Error(data.detail || 'Error Mailchimp');
    }

    throw new Error(`HTTP ${response.status}`);

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
