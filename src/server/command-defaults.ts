import type { CommandDefinition } from '../shared/commands.ts';

export function defaultCommands(): CommandDefinition[] {
  return [
    { trigger: '!discord', responses: ['Join de Faynominaal Discord! https://discord.gg/wgPqNe7xn'], cooldownSeconds: 60, enabled: true },
    { trigger: '!socials', responses: [
      'Website: https://faynominaal.netlify.app/',
      'Instagram: https://www.instagram.com/faynominaal/',
      'TikTok: https://www.tiktok.com/@faynominaal',
      'YouTube: https://www.youtube.com/@faynominaal',
      'Twitch: https://www.twitch.tv/faynominaal',
      'Snapchat: https://www.snapchat.com/@faynominaal'
    ], cooldownSeconds: 60, enabled: true },
    { trigger: '!dono', responses: ['Wil je de stream steunen? https://www.tipeeestream.com/faynominaal/donation'], cooldownSeconds: 60, enabled: true }
  ];
}
