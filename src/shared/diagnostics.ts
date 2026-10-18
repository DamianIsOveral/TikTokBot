import type {ChatCapabilities} from './capabilities.js';
export interface Readiness {
  receive:boolean;send:boolean;botEnabled:boolean;session?:ChatCapabilities['session'];
}
export interface Diagnostics {
  uptimeSeconds:number;rssMiB:number;readiness:Readiness;
  live:{connected:boolean;reconnects:number;lastEventAt:string|null};
  commands:{matched:number;sent:number;attempted:number;rateLimited:number;roleDenied:number;invalid:number;failed:number};
  signer:{initializations:number;requests:number;failures:number;p50Ms:number|null;p95Ms:number|null}|null;
}
