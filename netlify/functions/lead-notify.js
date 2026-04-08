exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' } };
  }

  try {
    const lead = JSON.parse(event.body);
    
    const RESEND_KEY = process.env.RESEND_API_KEY || 're_K7Cb53Je_AhujLpxkBzABEioD6KUn1R23';

    const html = `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px">
        <h2 style="color:#1a1a2e;border-bottom:2px solid #7c3aed;padding-bottom:12px">Nuevo lead desde viintas.com</h2>
        <table style="width:100%;border-collapse:collapse;margin-top:16px">
          <tr><td style="padding:10px 12px;font-weight:600;color:#555;width:140px">Nombre</td><td style="padding:10px 12px">${lead.contact_name || '-'}</td></tr>
          <tr style="background:#f8f8fc"><td style="padding:10px 12px;font-weight:600;color:#555">Email</td><td style="padding:10px 12px">${lead.email || '-'}</td></tr>
          <tr><td style="padding:10px 12px;font-weight:600;color:#555">Negocio</td><td style="padding:10px 12px">${lead.business_name || '-'}</td></tr>
          <tr style="background:#f8f8fc"><td style="padding:10px 12px;font-weight:600;color:#555">Teléfono</td><td style="padding:10px 12px">${lead.phone || '-'}</td></tr>
          <tr><td style="padding:10px 12px;font-weight:600;color:#555">Tipo</td><td style="padding:10px 12px">${lead.business_type || '-'}</td></tr>
          <tr style="background:#f8f8fc"><td style="padding:10px 12px;font-weight:600;color:#555">Descripción</td><td style="padding:10px 12px">${lead.description || '-'}</td></tr>
        </table>
        <p style="margin-top:20px;color:#888;font-size:13px">Lead registrado en el CRM automáticamente.</p>
      </div>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + RESEND_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Viintas <noreply@viintas.com>',
        to: 'ingkevinarias@gmail.com',
        subject: 'Nuevo lead: ' + (lead.business_name || 'Sin nombre') + ' — ' + (lead.contact_name || ''),
        html
      })
    });

    const data = await res.json();
    return {
      statusCode: res.ok ? 200 : 500,
      headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: res.ok, data })
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message })
    };
  }
};
