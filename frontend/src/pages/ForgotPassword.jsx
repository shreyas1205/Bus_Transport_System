import { useEffect, useState } from 'react';

const API = (
  import.meta.env.VITE_API_URL ||
  'http://localhost:4000/api'
).replace(/\/$/, '');

const field = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '12px',
  border: '1px solid #bdc9bf',
  borderRadius: '9px',
  font: 'inherit',
  marginTop: '7px'
};

const button = {
  ...field,
  cursor: 'pointer',
  background: '#d2f872',
  color: '#14241b',
  fontWeight: 700
};

const label = {
  display: 'block',
  marginTop: '17px',
  fontWeight: 600
};

async function post(path, body) {
  const response = await fetch(
    API + path,
    {
      method: 'POST',

      headers: {
        'Content-Type':
          'application/json'
      },

      body:
        JSON.stringify(body)
    }
  );

  const data =
    await response
      .json()
      .catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.message ||
        'The request failed. Please try again.'
    );
  }

  return data;
}

export default function ForgotPassword({
  onBack
}) {
  const [
    channels,
    setChannels
  ] = useState(null);

  const [
    identifier,
    setIdentifier
  ] = useState('');

  const [
    channel,
    setChannel
  ] = useState('email');

  const [
    challenge,
    setChallenge
  ] = useState(null);

  const [
    code,
    setCode
  ] = useState('');

  const [
    password,
    setPassword
  ] = useState('');

  const [
    confirmation,
    setConfirmation
  ] = useState('');

  const [
    busy,
    setBusy
  ] = useState(false);

  const [
    error,
    setError
  ] = useState('');

  const [
    message,
    setMessage
  ] = useState('');

  const [
    cooldown,
    setCooldown
  ] = useState(0);

  const [
    done,
    setDone
  ] = useState(false);


  useEffect(() => {
    const controller =
      new AbortController();

    fetch(
      API +
        '/auth/forgot-password/options',
      {
        signal:
          controller.signal
      }
    )
      .then(
        async response => {
          if (!response.ok) {
            throw new Error(
              'Could not load recovery options.'
            );
          }

          const data =
            await response.json();

          setChannels(data);

          setChannel(
            data.email
              ? 'email'
              : 'sms'
          );
        }
      )
      .catch(e => {
        if (
          e.name !==
          'AbortError'
        ) {
          setError(
            'Could not reach the backend. Please try again.'
          );
        }
      });

    return () =>
      controller.abort();
  }, []);


  useEffect(() => {
    if (!cooldown) {
      return;
    }

    const timer =
      setTimeout(
        () =>
          setCooldown(
            value =>
              Math.max(
                0,
                value - 1
              )
          ),

        1000
      );

    return () =>
      clearTimeout(timer);
  }, [cooldown]);


  async function requestCode(
    event
  ) {
    event?.preventDefault();

    if (busy) {
      return;
    }

    setBusy(true);
    setError('');
    setMessage('');

    try {
      const result =
        await post(
          '/auth/forgot-password',
          {
            identifier:
              identifier.trim(),

            channel
          }
        );

      setChallenge(
        result.challengeId
      );

      setCode('');

      setCooldown(
        result.resendAfterSeconds ||
          60
      );

      setMessage(
        result.message
      );

    } catch (e) {
      setError(
        e.message
      );

    } finally {
      setBusy(false);
    }
  }


  async function resetPassword(
    event
  ) {
    event.preventDefault();

    if (
      password.length < 12 ||
      password.length > 128
    ) {
      setError(
        'Use a password between 12 and 128 characters.'
      );

      return;
    }

    if (
      password !== confirmation
    ) {
      setError(
        'The passwords do not match.'
      );

      return;
    }

    setBusy(true);
    setError('');
    setMessage('');

    try {
      const result =
        await post(
          '/auth/reset-password',
          {
            challengeId:
              challenge,

            code:
              code.trim(),

            newPassword:
              password
          }
        );

      setPassword('');
      setConfirmation('');
      setCode('');
      setChallenge(null);

      setDone(true);

      setMessage(
        result.message
      );

    } catch (e) {
      setError(
        e.message
      );

    } finally {
      setBusy(false);
    }
  }


  function back() {
    if (onBack) {
      onBack();
    } else {
      window.location.assign(
        '/login'
      );
    }
  }


  return (
    <main
      style={{
        minHeight: '100vh',
        background: '#f1f5ef',
        display: 'grid',
        placeItems: 'center',
        padding: '24px',
        boxSizing: 'border-box',
        fontFamily:
          'system-ui, sans-serif',
        color: '#17271d'
      }}
    >
      <section
        aria-labelledby="recovery-title"
        style={{
          width: '100%',
          maxWidth: '450px',
          padding: '30px',
          boxSizing: 'border-box',
          background: 'white',
          borderRadius: '18px',
          border:
            '1px solid #dce4da'
        }}
      >
        <p
          style={{
            fontWeight: 800,
            letterSpacing: '1px',
            fontSize: '13px'
          }}
        >
          CAMPUSBUS
        </p>

        <h1
          id="recovery-title"
          style={{
            fontSize: '27px',
            marginBottom: '8px'
          }}
        >
          {done
            ? 'Password changed'
            : 'Forgot your password?'}
        </h1>

        <p
          style={{
            lineHeight: 1.6,
            color: '#556459'
          }}
        >
          {done
            ? 'You can now sign in with your new password.'
            : 'Recover your account using your registered email address or phone number.'}
        </p>

        {error && (
          <p
            role="alert"
            style={{
              color: '#a12020',
              lineHeight: 1.5
            }}
          >
            {error}
          </p>
        )}

        {message && (
          <p
            role="status"
            style={{
              color: '#315d37',
              lineHeight: 1.5
            }}
          >
            {message}
          </p>
        )}


        {!done &&
          !challenge && (
            <form
              onSubmit={
                requestCode
              }
            >
              <label
                style={label}
                htmlFor="recovery-identifier"
              >
                Email, phone number
                or institution ID
              </label>

              <input
                id="recovery-identifier"
                name="username"
                autoComplete="username"
                required
                maxLength={254}
                value={identifier}
                onChange={
                  event =>
                    setIdentifier(
                      event.target
                        .value
                    )
                }
                style={field}
                disabled={busy}
              />

              <p
                style={{
                  fontSize: '13px',
                  lineHeight: 1.5
                }}
              >
                For a shared family
                phone number, identify
                your account using your
                email or institution ID.
                Include the country code
                for non-Indian phone
                numbers.
              </p>

              <label
                style={label}
                htmlFor="recovery-channel"
              >
                Send code by
              </label>

              <select
                id="recovery-channel"
                value={channel}
                onChange={
                  event =>
                    setChannel(
                      event.target
                        .value
                    )
                }
                style={field}
                disabled={
                  busy ||
                  !channels
                }
              >
                <option
                  value="email"
                  disabled={
                    !channels?.email
                  }
                >
                  Email
                  {channels &&
                  !channels.email
                    ? ' — unavailable'
                    : ''}
                </option>

                <option
                  value="sms"
                  disabled={
                    !channels?.sms
                  }
                >
                  SMS
                  {channels &&
                  !channels.sms
                    ? ' — unavailable'
                    : ''}
                </option>
              </select>

              {channels &&
                !channels.email &&
                !channels.sms && (
                  <p role="status">
                    Recovery delivery
                    is not configured
                    yet. Contact your
                    administrator.
                  </p>
                )}

              <button
                type="submit"
                style={button}
                disabled={
                  busy ||
                  !channels?.[
                    channel
                  ]
                }
              >
                {busy
                  ? 'Requesting code…'
                  : 'Send verification code'}
              </button>
            </form>
          )}


        {!done &&
          challenge && (
            <form
              onSubmit={
                resetPassword
              }
            >
              <p
                style={{
                  fontSize: '14px',
                  lineHeight: 1.5
                }}
              >
                Use the latest code
                within 10 minutes.
                Only five incorrect
                attempts are allowed.
                Check spam for email
                codes.
              </p>

              <label
                style={label}
                htmlFor="recovery-code"
              >
                Six-digit code
              </label>

              <input
                id="recovery-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                required
                value={code}
                onChange={
                  event =>
                    setCode(
                      event.target
                        .value.replace(
                          /\D/g,
                          ''
                        )
                    )
                }
                style={field}
                disabled={busy}
              />

              <label
                style={label}
                htmlFor="recovery-password"
              >
                New password
              </label>

              <input
                id="recovery-password"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                value={password}
                onChange={
                  event =>
                    setPassword(
                      event.target
                        .value
                    )
                }
                style={field}
                disabled={busy}
              />

              <label
                style={label}
                htmlFor="recovery-confirmation"
              >
                Confirm new password
              </label>

              <input
                id="recovery-confirmation"
                type="password"
                autoComplete="new-password"
                minLength={12}
                maxLength={128}
                required
                value={
                  confirmation
                }
                onChange={
                  event =>
                    setConfirmation(
                      event.target
                        .value
                    )
                }
                style={field}
                disabled={busy}
              />

              <p
                style={{
                  fontSize: '13px'
                }}
              >
                Use 12–128 characters.
                A memorable passphrase
                works well.
              </p>

              <button
                type="submit"
                style={button}
                disabled={busy}
              >
                {busy
                  ? 'Checking code…'
                  : 'Verify code and reset password'}
              </button>

              <button
                type="button"
                style={{
                  ...button,
                  background:
                    '#edf1eb'
                }}
                disabled={
                  busy ||
                  cooldown > 0
                }
                onClick={
                  requestCode
                }
              >
                {cooldown
                  ? 'Resend available in ' +
                    cooldown +
                    's'
                  : 'Resend code'}
              </button>

              <button
                type="button"
                style={{
                  ...button,
                  background:
                    'white'
                }}
                disabled={busy}
                onClick={() => {
                  setChallenge(
                    null
                  );

                  setCode('');
                  setPassword('');
                  setConfirmation('');
                  setError('');
                  setMessage('');
                }}
              >
                Use another account
                or method
              </button>
            </form>
          )}

        <button
          type="button"
          onClick={back}
          disabled={busy}
          style={{
            border: 0,
            background: 'none',
            color: '#315d37',
            marginTop: '20px',
            cursor: 'pointer',
            font: 'inherit'
          }}
        >
          Back to login
        </button>
      </section>
    </main>
  );
}