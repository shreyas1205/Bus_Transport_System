export function jwtSecret() {
  const secret = process.env.JWT_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      'Set JWT_SECRET to a random secret of at least 32 characters in backend/.env.'
    );
  }

  return secret;
}

export function otpSecret() {
  const secret = process.env.OTP_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      'Set OTP_SECRET to a separate random secret of at least 32 characters in backend/.env.'
    );
  }

  return secret;
}