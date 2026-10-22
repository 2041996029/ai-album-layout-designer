/** Immutable content-addressed resources. No resource variant may substitute another. */
export type ResourceVariant = 'original'|'normalized'|'preview'|'font';
export interface ResourceSource { readonly kind:'import'|'bundled'; readonly name:string; readonly url?:string }
export interface ResourceLicense { readonly id:string; readonly usable:boolean; readonly source?:string; readonly text?:string }
export type ResourceStatus = 'ready'|'missing'|'unlicensed';
export interface ImageVariant {
  readonly sha256:string; readonly byteLength:number; readonly mimeType:'image/png'|'image/jpeg';
  readonly width:number; readonly height:number;
}
export interface AssetRecord {
  readonly id:string; readonly version:number; /** Original file SHA-256. */ readonly sha256:string;
  readonly width:number; readonly height:number; readonly mimeType:'image/png'|'image/jpeg';
  readonly source:ResourceSource; readonly license:ResourceLicense; readonly status:ResourceStatus;
  readonly variants:Readonly<Record<'original'|'normalized'|'preview',ImageVariant>>;
}
export interface FontFaceRecord {
  /** Independent resource ID of this exact local subset. */ readonly id:string;
  readonly sha256:string; readonly byteLength:number; readonly file:string;
  readonly weight:400|700; readonly style:'normal'; readonly codePoints:readonly number[];
}
export interface FontRecord {
  readonly id:string; readonly version:number; /** Hash of canonical face identities and provenance. */ readonly sha256:string;
  readonly family:string; readonly source:ResourceSource; readonly license:ResourceLicense; readonly status:ResourceStatus;
  readonly faces:readonly FontFaceRecord[];
}
export interface ResourceManifest { readonly assets:readonly AssetRecord[]; readonly fonts:readonly FontRecord[] }
export interface AssetBytes { readonly original:Uint8Array; readonly normalized:Uint8Array; readonly preview:Uint8Array }
export interface LoadedFont {
  readonly family:string; readonly faces:readonly FontFaceRecord[]; readonly codePoints:ReadonlySet<number>;
  dispose():void;
}
