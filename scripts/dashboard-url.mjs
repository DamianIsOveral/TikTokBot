import { readConfig } from '../src/config.js';

const { host, port } = readConfig();
console.log(`http://${host === '::1' ? '[::1]' : host}:${port}`);
