import { addMessage, resetMessages } from './model.js';

const examples: [string, string, string][] = [
  ['Daan', 'Welke settings gebruik je?', '01:37'],
  ['bozekijker', 'Jij bent echt een sukkel', '01:38'],
  ['Julia', 'Zo gezellig hier 💕', '01:38'],
  ['chatspammer', 'VOLG MIJ! VOLG MIJ! VOLG MIJ!', '01:39'],
  ['Tim', 'Wat een skills zeg 👏', '01:39'],
  ['Sanne', 'Deze game is echt ziek!', '01:39'],
  ['promo_account', 'Gratis volgers? Klik op deze link!', '01:40'],
  ['Mike', 'Wanneer ga je weer live?', '01:40'],
  ['Naomi', 'Hahaha geweldig 😂', '01:41'],
  ['Sem', '!discord', '01:41'],
  ['Kevin', 'Wat een lekkere stream 🔥', '01:42'],
  ['Lisa', 'Goedenavond allemaal! 👋', '01:42']
];
const samples: [string, string][] = [
  ['NieuweKijker', 'Hoi allemaal! 👋'], ['link_account', 'Check https://voorbeeld.nl'],
  ['test_spam', 'VOLG MIJ! VOLG MIJ! VOLG MIJ!'], ['test_kijker', 'Wat een sukkel']
];
let nextSample = 0;

export function loadDemo(): void {
  resetMessages();
  for (const sample of examples) addMessage(...sample);
}

export function addSample(): void { addMessage(...samples[nextSample++ % samples.length]); }
