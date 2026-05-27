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
        body: JSON.stringify({ error: 'Missing config', apiKey: !!apiKey, listId: !!listId })
      };
    }

    const dc = apiKey.split('-').pop();
    const credentials = Buffer.from(`anystring:${apiKey}`).toString('base64');
    const url = `https://${dc}.api.mailchimp.com/3.0/lists/${listId}/members`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${credentials}`
      },
      body: JSON.stringify({
        email_address: email,
        status: 'subscribed',
        tags: ['Analizador-CV']
      })
    });

    const data = await response.json();

    return {
      statusCode: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ 
        success: response.ok,
        status: response.status,
        mailchimp_response: data,
        dc: dc,
        listId: listId
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
