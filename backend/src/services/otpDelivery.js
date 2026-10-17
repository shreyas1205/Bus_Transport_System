import nodemailer from 'nodemailer';

let transporter;

export function deliveryChannels() {
  return {
    email: Boolean(
      process.env.SMTP_HOST &&
        process.env.SMTP_USER &&
        process.env.SMTP_PASS &&
        process.env.SMTP_FROM
    ),

    sms: Boolean(
      process.env.TWILIO_ACCOUNT_SID &&
        process.env.TWILIO_AUTH_TOKEN &&
        (
          process.env.TWILIO_FROM_NUMBER ||
          process.env.TWILIO_MESSAGING_SERVICE_SID
        )
    ),
  };
}

export function normalisePhone(value) {
  if (
    typeof value !== 'string' ||
    !/^\+?[\d\s().-]+$/.test(value.trim())
  ) {
    return null;
  }

  const trimmed = value.trim();

  let digits =
    trimmed.replace(/\D/g, '');

  // The existing CampusBus database
  // uses Indian national numbers.
  if (
    !trimmed.startsWith('+') &&
    digits.length === 10
  ) {
    digits = '91' + digits;
  }

  if (
    !/^[1-9]\d{7,14}$/.test(digits)
  ) {
    return null;
  }

  return '+' + digits;
}

export async function sendOtp({
  channel,
  destination,
  code,
}) {
  const message =
    'Your CampusBus password reset code is ' +
    code +
    '. It expires in 10 minutes. Do not share this code. Ignore this message if you did not request it.';

  // ==========================
  // EMAIL
  // ==========================
  if (channel === 'email') {
    if (!deliveryChannels().email) {
      throw new Error(
        'EMAIL_NOT_CONFIGURED'
      );
    }

    if (!transporter) {
      const port =
        Number(
          process.env.SMTP_PORT ||
            587
        );

      transporter =
        nodemailer.createTransport({
          host:
            process.env.SMTP_HOST,

          port,

          secure:
            port === 465,

          requireTLS:
            port !== 465,

          auth: {
            user:
              process.env.SMTP_USER,

            pass:
              process.env.SMTP_PASS,
          },

          connectionTimeout:
            10000,

          greetingTimeout:
            10000,

          socketTimeout:
            15000,
        });
    }

    const result =
      await transporter.sendMail({
        from:
          process.env.SMTP_FROM,

        to:
          destination,

        subject:
          'CampusBus password reset code',

        text:
          message,
      });

    if (
      !result.accepted?.length
    ) {
      throw new Error(
        'EMAIL_NOT_ACCEPTED'
      );
    }

    return;
  }

  // ==========================
  // SMS
  // ==========================
  if (
    channel !== 'sms' ||
    !deliveryChannels().sms
  ) {
    throw new Error(
      'SMS_NOT_CONFIGURED'
    );
  }

  const sid =
    process.env
      .TWILIO_ACCOUNT_SID;

  if (
    !/^AC[a-fA-F0-9]{32}$/.test(
      sid
    )
  ) {
    throw new Error(
      'SMS_ACCOUNT_INVALID'
    );
  }

  const body =
    new URLSearchParams({
      To: destination,
      Body: message,
    });

  if (
    process.env
      .TWILIO_MESSAGING_SERVICE_SID
  ) {
    body.set(
      'MessagingServiceSid',
      process.env
        .TWILIO_MESSAGING_SERVICE_SID
    );
  } else {
    body.set(
      'From',
      process.env
        .TWILIO_FROM_NUMBER
    );
  }

  const response =
    await fetch(
      'https://api.twilio.com/2010-04-01/Accounts/' +
        sid +
        '/Messages.json',

      {
        method: 'POST',

        headers: {
          Authorization:
            'Basic ' +
            Buffer.from(
              sid +
                ':' +
                process.env
                  .TWILIO_AUTH_TOKEN
            ).toString(
              'base64'
            ),

          'Content-Type':
            'application/x-www-form-urlencoded',
        },

        body,

        signal:
          AbortSignal.timeout(
            15000
          ),
      }
    );

  if (!response.ok) {
    throw new Error(
      'SMS_PROVIDER_REJECTED'
    );
  }

  const result =
    await response.json();

  if (
    !result.sid ||
    [
      'failed',
      'undelivered',
      'canceled',
    ].includes(
      result.status
    )
  ) {
    throw new Error(
      'SMS_NOT_ACCEPTED'
    );
  }
}