import { z } from 'zod';
import { battlenetKeys } from './battlenet.keys.js';

const regionSchema = z.enum(['us', 'eu', 'kr', 'tw']);

const battlenetConfigSchema = z.object({
  clientId: z.string().min(1, 'BNET_CLIENT_ID is required'),
  clientSecret: z.string().min(1, 'BNET_CLIENT_SECRET is required'),
  region: regionSchema,
  redirectUri: z.url({
    message: 'BNET_REDIRECT_URI must be a valid URL',
  }),
});

const parsed = battlenetConfigSchema.safeParse(battlenetKeys);

if (!parsed.success) {
  throw new Error(
    `Invalid Battle.net configuration: ${z.prettifyError(parsed.error)}`,
  );
}

export type BattlenetRegion = z.infer<typeof regionSchema>;

export const battlenetConfig = parsed.data;

export const battlenetOauthBaseUrl = `https://${battlenetConfig.region}.battle.net/oauth`;
export const battlenetApiBaseUrl = `https://${battlenetConfig.region}.api.blizzard.com`;
export const battlenetProfileNamespace = `profile-${battlenetConfig.region}`;
