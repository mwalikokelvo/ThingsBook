'use strict';
// Windows app: while reading aloud, ask the desktop shell to keep the PC from suspending the app and to
// keep a minimised window's timers at full speed; release both when reading stops or pauses.
(() => {
  const desktop = window.ThingsBookDesktop;
  if (!desktop?.narrating || !window.ThingsListening || !window.ThingsReader) return;
  let last = null;
  const update = () => { const on = !!ThingsReader.isSpeaking(); if (on === last) return; last = on; try { desktop.narrating(on); } catch {} };
  const previous = ThingsListening.stateChanged;
  ThingsListening.stateChanged = () => { previous(); update(); };
  const dialog = document.getElementById('reader-dialog');
  if (dialog) new MutationObserver(update).observe(dialog, {attributes:true, attributeFilter:['open','data-narration']});
  window.addEventListener('pagehide', () => { try { desktop.narrating(false); } catch {} });
  update();
})();
