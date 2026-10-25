import type { FontRecord } from './types';
import { sha256 } from './resource-port';
/** Order-independent object serialization; array order is part of the pinned version. */
export function fontRecordHash(record:Pick<FontRecord,'source'|'license'|'faces'>):Promise<string> {
 const {source,license,faces}=record;
 return sha256(new TextEncoder().encode(JSON.stringify([
  [source.kind,source.name,source.url??null],
  [license.id,license.usable,license.source??null,license.text??null],
  faces.map(face=>[face.id,face.sha256,face.byteLength,face.file,face.weight,face.style,face.codePoints]),
 ])));
}
