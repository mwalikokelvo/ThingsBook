'use strict';
// Books opened with, or shared to, ThingsBook on Android ("Open with", the share sheet). MainActivity keeps
// each incoming file as a one-time ticket; once the library is unlocked and idle, they are fetched from
// /shared-file (streamed from the sending app, readable once) and the usual import dialog opens with them
// selected, so shelf and details can still be chosen. Nothing is imported without that confirmation.
const ThingsSharedFiles = (() => {
  const MAX = 20;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const ready = () => typeof key !== 'undefined' && !!key && !busy && !document.getElementById('upload-dialog')?.open;
  let native = null, running = false, again = false;

  async function receive() {
    if (!native) return;
    if (running) { again = true; return; }  // files that arrive meanwhile are picked up right after
    running = true; again = false;
    try {
      while (!ready()) await wait(500);  // locked, saving, or another import open: try again shortly
      let list = [];
      try { list = JSON.parse(native.sharedFiles() || '[]'); } catch { list = []; }
      if (!Array.isArray(list) || !list.length) return;
      const files = [], failed = [];
      for (const item of list.slice(0, MAX)) {
        const name = String(item?.name || 'Shared book').slice(0, 200);
        try {
          if (!/^[a-f0-9-]{36}$/.test(String(item?.ticket))) throw new Error('invalid ticket');
          const response = await fetch('/shared-file?ticket=' + encodeURIComponent(item.ticket), {credentials:'omit', cache:'no-store', referrerPolicy:'no-referrer'});
          if (!response.ok) throw new Error(String(response.status));
          files.push(new File([await response.blob()], name));
        } catch { failed.push(name); }
      }
      while (!ready()) await wait(500);
      if (files.length) openUpload(files);
      if (failed.length) toast(`Could not open ${failed.length === 1 ? 'this shared file' : 'these shared files'}: ${failed.slice(0, 5).join(', ')}. Share ${failed.length === 1 ? 'it' : 'them'} again.`);
    } finally {
      running = false;
      if (again) setTimeout(receive, 0);
    }
  }

  function attach(bridge) {
    if (!bridge?.sharedFiles) return false;
    native = bridge;
    window.nativeSharedFiles = receive;  // called by MainActivity when files arrive while the app is open
    setTimeout(receive, 0);              // files that started the app
    return true;
  }

  attach(window.ThingsBookAndroid);
  return Object.freeze({attach, receive});
})();
if (typeof module !== 'undefined') module.exports = ThingsSharedFiles;
