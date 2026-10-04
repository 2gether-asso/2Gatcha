// Configuration par variables d'environnement (voir api/.env.example).
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const env = process.env;

export const config = {
  port: Number(env.PORT || 8080),
  dbPath: env.DB_PATH || path.resolve(here, '../data/2gatcha.sqlite'),
  workflowsDir: env.WORKFLOWS_DIR || path.resolve(here, '../../n8n/workflows'),
  // Dossier du site statique a servir aussi (optionnel, vide = API seule).
  siteDir: env.SITE_DIR || '',
  // Adresse de l'API injectee dans le js/config.js du site servi par l'API.
  siteApiBase: env.SITE_API_BASE || '/webhook/',
  // Mot de passe de la page d'administration de la base (vide = desactivee).
  adminToken: env.ADMIN_TOKEN || '',
  // Origines autorisees pour le CORS ("*" par defaut, comme les webhooks n8n).
  allowedOrigins: (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim()).filter(Boolean),
  // Valeurs injectees dans la sortie des noeuds "Set Config" des workflows :
  // secrets et URLs propres a l'hebergement, qui ne doivent pas vivre dans le
  // depot. Une cle absente du "Set Config" d'un workflow est ignoree.
  overrides: Object.fromEntries(Object.entries({
    clientSecret: env.DISCORD_CLIENT_SECRET,
    clientId: env.DISCORD_CLIENT_ID,
    redirectUri: env.DISCORD_REDIRECT_URI,
    guildId: env.DISCORD_GUILD_ID,
    discordWebhookUrl: env.DISCORD_WEBHOOK_URL
  }).filter(([, v]) => v != null && v !== ''))
};
