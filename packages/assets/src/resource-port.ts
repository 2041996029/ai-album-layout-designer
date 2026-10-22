import type { DocumentIssue } from '@album/document';
import type { AssetBytes, AssetRecord, FontRecord, ResourceVariant } from './types';
export interface ResourcePort { read(id:string,variant:ResourceVariant):Promise<Uint8Array> }
export interface ResourceWriter {
  putAsset(record:AssetRecord,data:AssetBytes):Promise<void>;
  putFont(record:FontRecord,files:ReadonlyMap<string,Uint8Array>):Promise<void>;
}
export class ResourceError extends Error {
  constructor(readonly code:string,message:string) { super(message);this.name='ResourceError'; }
  toIssue(path='resources'):DocumentIssue {return {code:this.code,message:this.message,path,severity:'blocker'};}
}
export function assertActive(signal:AbortSignal):void { signal.throwIfAborted(); }
export async function sha256(bytes:Uint8Array):Promise<string> {
  const digest=await crypto.subtle.digest('SHA-256',new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
}
