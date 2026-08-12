const { createHmac, timingSafeEqual } = require("node:crypto");

/**
 * Send SMS hook de Supabase Auth — entrega el OTP por WhatsApp.
 *
 * Por qué vive acá y no en un producto: los hooks de Supabase son por PROYECTO,
 * no por app. Tupola, TuPlaza y baby comparten el proyecto `viintas-crm`, así
 * que existe un único hook de envío para los tres. Estaba hospedado en el deploy
 * de Tupola —alguien tenía que hostearlo y fue el primero que hubo— y eso dejaba
 * el login de TuPlaza y de baby colgando de que Tupola no rompiera un deploy.
 * viintas.com no es de ningún producto, que es justo la propiedad que hace falta.
 *
 * Contrato: Supabase hace POST con `{ user, sms: { otp } }` firmado según
 * Standard Webhooks. Si respondemos algo distinto de 2xx, el cliente recibe
 * error y no se crea la sesión — así que un fallo de WhatsApp devuelve 500, no
 * 200: mejor que le diga "no se pudo enviar" a dejarlo esperando un código que
 * nunca va a llegar.
 *
 * ⚠️ Este repo es PÚBLICO. Nada de credenciales en el código: todo por env vars
 * del sitio en Netlify. La URL del endpoint es pública por definición y no es un
 * secreto — lo que impide que un tercero dispare mensajes es la firma.
 */

const API_VERSION = "v21.0";
/** Template ya aprobado en Meta. Es de Viintas, no de un producto. */
const TEMPLATE_NAME = "otp_viintas_v1";
const LANGUAGE_CODE = "es_CO";

/**
 * Verificación Standard Webhooks. El secreto viene como `v1,whsec_<base64>`; se
 * firma `${id}.${timestamp}.${body}` y la firma llega en `webhook-signature`,
 * que puede traer varias separadas por espacio (rotación de secretos).
 */
function isSignatureValid(rawBody, headers, secret) {
  const id = headers["webhook-id"];
  const timestamp = headers["webhook-timestamp"];
  const signatureHeader = headers["webhook-signature"];
  if (!id || !timestamp || !signatureHeader) return false;

  // Ventana de 5 min: sin esto, una request capturada se puede reenviar para
  // disparar mensajes de WhatsApp indefinidamente.
  const ageSec = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSec) || ageSec > 300) return false;

  const base64Secret = secret.replace(/^v1,whsec_/, "").replace(/^whsec_/, "");
  const key = Buffer.from(base64Secret, "base64");
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");

  return signatureHeader
    .split(" ")
    .map((part) => (part.startsWith("v1,") ? part.slice(3) : part))
    .some((candidate) => {
      const a = Buffer.from(candidate);
      const b = Buffer.from(expected);
      return a.length === b.length && timingSafeEqual(a, b);
    });
}

async function sendOtpTemplate({ to, code, token, phoneId }) {
  const body = {
    messaging_product: "whatsapp",
    to,
    type: "template",
    template: {
      name: TEMPLATE_NAME,
      language: { code: LANGUAGE_CODE },
      components: [
        { type: "body", parameters: [{ type: "text", text: code }] },
        // El botón del template copia el código; Meta exige el índice.
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: code }],
        },
      ],
    },
  };

  const res = await fetch(
    `https://graph.facebook.com/${API_VERSION}/${phoneId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );

  if (res.ok) return { ok: true };

  const data = await res.json().catch(() => ({}));
  const message =
    (data && data.error && data.error.message) || `HTTP ${res.status}`;
  return { ok: false, error: message };
}

const json = (statusCode, payload) => ({
  statusCode,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload),
});

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Método no permitido" });
  }

  const secret = process.env.SUPABASE_AUTH_SMS_HOOK_SECRET;
  const token = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_NUMBER_ID;

  // Fail closed: sin secreto no podemos distinguir a Supabase de cualquiera que
  // descubra la URL, y esto dispara mensajes reales.
  if (!secret || !token || !phoneId) {
    console.error("[auth-send-sms] faltan variables de entorno");
    return json(500, { error: "Hook no configurado" });
  }

  // Netlify puede entregar el cuerpo en base64. La firma se calcula sobre el
  // texto exacto que mandó Supabase, así que hay que decodificar antes de
  // verificar o toda request legítima parecería falsificada.
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body || "";

  if (!isSignatureValid(rawBody, event.headers || {}, secret)) {
    console.warn("[auth-send-sms] firma inválida");
    return json(401, { error: "Firma inválida" });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json(400, { error: "Payload inválido" });
  }

  const phone = ((payload.user && payload.user.phone) || "").replace(
    /[^\d]/g,
    "",
  );
  const code = payload.sms && payload.sms.otp;
  if (!phone || !code) {
    console.error("[auth-send-sms] falta phone u otp en el payload");
    return json(400, { error: "Payload incompleto" });
  }

  const wa = await sendOtpTemplate({ to: phone, code, token, phoneId });
  if (!wa.ok) {
    console.error("[auth-send-sms] WhatsApp falló:", wa.error);
    return json(500, { error: "No pudimos enviar el código por WhatsApp" });
  }

  // Nunca se loguea el código: quedaría en claro en los logs de Netlify.
  console.log(`[auth-send-sms] OTP entregado a ${phone.slice(0, 5)}***`);
  return json(200, {});
};
