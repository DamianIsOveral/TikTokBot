import { readConfig } from '../src/server/config.ts';

const { host, port } = readConfig();
console.log(`http://${host === '::1' ? '[::1]' : host}:${port}`);
