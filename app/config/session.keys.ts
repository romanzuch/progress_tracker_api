export const sessionKeys = {
  jwtSecret: process.env.SESSION_JWT_SECRET ?? '',
  jwtExpiresIn: process.env.SESSION_JWT_EXPIRES_IN ?? '7d',
  tokenEncryptionKey: process.env.TOKEN_ENCRYPTION_KEY ?? '',
};
