import { readConfig } from '../src/server/config.ts';
try {
  const config = readConfig();
  const discordConfigured = !!(config.discord.clientId && config.discord.clientSecret && config.discord.adminIds.length);
  console.log(JSON.stringify({ valid: true, discordConfigured, transport: config.chatTransport,
    botEnabled: config.botEnabled, directConfigured: !!config.directCredentials,
    autoConnect: config.autoConnect, autoReconnect: config.autoReconnect, publicDeployment: false }));
  if (!discordConfigured) process.exitCode = 1;
} catch (error) {
  console.log(JSON.stringify({ valid: false, message: error instanceof Error ? error.message : 'Configuratie ongeldig.' }));
  process.exitCode = 1;
}
