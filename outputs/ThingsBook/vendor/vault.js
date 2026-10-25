'use strict';
// UI-independent cryptography. Keys and decrypted values are never persisted here.
const ThingsVault = (() => {
  const encoder = new TextEncoder(), decoder = new TextDecoder();
  async function derive(password, salt) {
    const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2', salt, iterations:310000, hash:'SHA-256'}, material,
      {name:'AES-GCM',length:256}, false, ['encrypt','decrypt']);
  }
  async function seal(data, key) {
    if (!key) throw new Error('Unlock your library before saving.');
    const iv = crypto.getRandomValues(new Uint8Array(12));
    return {iv, data:await crypto.subtle.encrypt({name:'AES-GCM',iv}, key, data)};
  }
  async function unseal(record, key) {
    if (!key) throw new Error('Unlock your library before reading.');
    return crypto.subtle.decrypt({name:'AES-GCM',iv:record.iv}, key, record.data);
  }
  const sealJSON = (value,key) => seal(encoder.encode(JSON.stringify(value)),key);
  const readJSON = async (record,key) => JSON.parse(decoder.decode(await unseal(record,key)));
  return Object.freeze({derive,seal,unseal,sealJSON,readJSON});
})();
if (typeof module !== 'undefined') module.exports = ThingsVault;

// Device access is separate from portable backups. Native builds require OS
// protection; browsers can clone a non-exportable key into their own profile.
const ThingsDeviceAccess = Object.freeze({
  recoveryCode() {
    return Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2,'0')).join('').match(/.{8}/g).join('-');
  },
  async remember(secret, key, fingerprint) {
    if (window.ThingsBookDesktop) {
      if (!window.ThingsBookDesktop.protectAccess) throw new Error('Update the desktop app to enable password-free access.');
      const wrapped = await window.ThingsBookDesktop.protectAccess(secret);
      if (await window.ThingsBookDesktop.revealAccess(wrapped) !== secret) throw new Error('Windows could not verify device access. No library changes were saved.');
      return {version:1,fingerprint,kind:'windows',wrapped};
    }
    if (window.ThingsBookAndroid) {
      if (!window.ThingsBookAndroid.protectAccess) throw new Error('Update the Android app to enable password-free access.');
      const wrapped = window.ThingsBookAndroid.protectAccess(secret);
      if (!wrapped || window.ThingsBookAndroid.revealAccess(wrapped) !== secret) throw new Error('Android could not verify device access. No library changes were saved.');
      return {version:1,fingerprint,kind:'android',wrapped};
    }
    return {version:1,fingerprint,kind:'browser',key};
  },
  async open(record, config) {
    if (!record || record.version !== 1 || record.fingerprint !== Array.from(config.check.iv).join(',')) throw new Error('Device access is unavailable.');
    if (record.kind === 'browser' && !window.ThingsBookDesktop && !window.ThingsBookAndroid && record.key?.extractable === false) return record.key;
    let secret;
    if (record.kind === 'windows') secret = await window.ThingsBookDesktop?.revealAccess?.(record.wrapped);
    if (record.kind === 'android') secret = window.ThingsBookAndroid?.revealAccess?.(record.wrapped);
    if (typeof secret !== 'string' || !secret.length) throw new Error('Device access is unavailable.');
    return ThingsVault.derive(secret,config.salt);
  }
});
