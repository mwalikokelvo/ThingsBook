'use strict';
// Tidies the reader tools once every module has added its controls: study tools get their own tab,
// controls that had no visible name get one, sliders show their value, and the font file picker
// uses an app button instead of the raw "Choose File" box. Existing IDs and listeners are kept.
(() => {
  const dock = window.ThingsReaderDock, dialog = document.getElementById('reader-dialog');
  if (!dock || !dialog) return;
  const make = (tag, cls, text) => { const node = document.createElement(tag); if (cls) node.className = cls; if (text) node.textContent = text; return node; };
  const label = (control, text, cls = '') => { if (!control || control.closest('label')) return; const wrap = make('label', cls); wrap.append(make('span', 'tool-label', text)); control.replaceWith(wrap); wrap.append(control); };

  // Study tab: reflections, dictionary, citations, comparison and flashcards.
  const tools = dialog.querySelector('.sanctuary-reader-tools');
  if (tools) {
    const study = make('div', 'study-tools');
    for (const button of [...tools.querySelectorAll(':scope > button')]) if (/^(Reflections|Dictionary|Cite|Compare|Flashcard|Links?)$/.test(button.textContent.trim())) study.append(button);
    if (study.children.length) dock.addSection('Study', [study], 'Notes');
  }

  // Sidebar links added as buttons ("Connections", "Daily recall") look like the other links, not like
  // the selected one.
  for (const button of document.querySelectorAll('.sidebar button.secondary')) { button.classList.remove('secondary'); button.classList.add('nav-item', 'study-link'); }

  // Names for controls that only had an accessible label.
  label(dialog.querySelector('input[aria-label="Narration passage"]'), 'Passage in this chapter', 'wide-tool');
  label(dialog.querySelector('select[aria-label="Ambient sound"]'), 'Ambient sound');
  label(dialog.querySelector('input[aria-label="Ambient volume"]'), 'Ambient volume');
  const previous = document.getElementById('narrator-previous'), next = document.getElementById('narrator-next');
  if (previous) { previous.textContent = '↶ Previous passage'; previous.title = 'Read the previous passage'; }
  if (next) { next.textContent = 'Next passage ↷'; next.title = 'Skip to the next passage'; }

  // Slider values (the reader sets saved values without events when a book opens).
  const updaters = [];
  new MutationObserver(() => { for (const update of updaters) update(); }).observe(dialog, {attributes:true, attributeFilter:['open']});
  dock.onExpand = () => { for (const update of updaters) update(); };
  const show = (id, format) => { const input = typeof id === 'string' ? document.getElementById(id) : id; if (!input || input.dataset.valueShown) return; input.dataset.valueShown = 'true'; const value = make('output', 'tool-value'); const update = () => { value.textContent = format(Number(input.value)); }; input.addEventListener('input', update); input.addEventListener('change', update); input.after(value); update(); updaters.push(update); };
  show('reader-size', v => v + ' px');
  show('reader-tracking', v => v ? v.toFixed(2) + ' em' : 'Normal');
  show('reader-measure', v => v + ' characters');
  show('narrator-volume', v => Math.round(v * 100) + '%');
  show(dialog.querySelector('input[aria-label="Ambient volume"]'), v => Math.round(v * 100) + '%');

  // The personal font picker.
  for (const input of dialog.querySelectorAll('.reader-dock input[type=file]')) {
    const button = make('button', 'secondary', 'Choose a font file…'), name = make('span', 'tool-file-name', 'No font chosen');
    button.type = 'button'; button.onclick = () => input.click(); input.classList.add('visually-hidden'); input.tabIndex = -1;
    input.addEventListener('change', () => { name.textContent = input.files?.[0]?.name || 'No font chosen'; });
    input.after(button, name);
  }
})();
