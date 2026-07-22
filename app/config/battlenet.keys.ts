export const battlenetKeys = {
  clientId: process.env.BNET_CLIENT_ID ?? '',
  clientSecret: process.env.BNET_CLIENT_SECRET ?? '',
  region: process.env.BNET_REGION ?? 'us',
  redirectUri: process.env.BNET_REDIRECT_URI ?? '',
};
