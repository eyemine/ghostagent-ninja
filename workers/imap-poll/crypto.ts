/// <reference types="@cloudflare/workers-types" />

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const arr = new Uint8Array(clean.length / 2);
  for (let i = 0; i < arr.length; i++) arr[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return arr;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return bytesToHex(new Uint8Array(buf));
}

function buf(u: Uint8Array): ArrayBuffer {
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
}

export async function encryptBody(body: string, pubkeyHex: string): Promise<{ epk: string; iv: string; ct: string }> {
  const recipientKey = await crypto.subtle.importKey('raw', buf(hexToBytes(pubkeyHex)), { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const sharedBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: recipientKey }, ephemeral.privateKey, 256);
  const epkRaw = await crypto.subtle.exportKey('raw', ephemeral.publicKey);
  const ivBytes = crypto.getRandomValues(new Uint8Array(12));
  const ivBuf = buf(ivBytes);
  const baseKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey']);
  const aesKey = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: ivBuf, info: new TextEncoder().encode('nftmail-inbox-v1') },
    baseKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']
  );
  const ptBytes = new TextEncoder().encode(body);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: ivBuf }, aesKey, buf(ptBytes));
  return { epk: bytesToHex(new Uint8Array(epkRaw)), iv: bytesToHex(ivBytes), ct: bytesToHex(new Uint8Array(ct)) };
}
