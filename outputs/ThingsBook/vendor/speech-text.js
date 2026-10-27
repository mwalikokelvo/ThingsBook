'use strict';
// Spoken form of a passage for the personal (neural) voices, which read digits and abbreviations
// poorly: "August 22, 2022" becomes "August twenty-second, twenty twenty-two", "Dr." becomes "Doctor"
// and "R.A." becomes "R. A.". Only the audio changes; the page text, highlights and saved places use
// the original text. System voices do their own reading and are not given this text.
window.ThingsSpeechText = (() => {
  const ones = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
  const tens = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
  const ordinalWords = {one:'first',two:'second',three:'third',five:'fifth',eight:'eighth',nine:'ninth',twelve:'twelfth'};
  function under100(n) { return n < 20 ? ones[n] : tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : ''); }
  function under1000(n) { const h = Math.floor(n / 100), r = n % 100; return (h ? ones[h] + ' hundred' + (r ? ' ' : '') : '') + (r || !h ? under100(r) : ''); }
  function cardinal(n) {
    if (!Number.isSafeInteger(n) || n < 0) return String(n);
    if (n < 1000) return under1000(n);
    const parts = []; let rest = n;
    for (const [size, name] of [[1e12,'trillion'],[1e9,'billion'],[1e6,'million'],[1e3,'thousand']]) { const count = Math.floor(rest / size); if (count) { parts.push(under1000(count) + ' ' + name); rest %= size; } }
    if (rest) parts.push(under1000(rest));
    return parts.join(' ');
  }
  function ordinal(n) {
    const words = cardinal(n), last = words.match(/([a-z]+)$/)[1];
    if (ordinalWords[last]) return words.slice(0, -last.length) + ordinalWords[last];
    if (last.endsWith('y')) return words.slice(0, -1) + 'ieth';
    return words + 'th';
  }
  function year(n) {
    if (n % 1000 === 0 || (n >= 2000 && n < 2010)) return cardinal(n);
    const high = Math.floor(n / 100), low = n % 100;
    if (!low) return under100(high) + ' hundred';
    return under100(high) + ' ' + (low < 10 ? 'oh ' + ones[low] : under100(low));
  }
  const months = 'January|February|March|April|May|June|July|August|September|October|November|December|Jan\\.|Feb\\.|Mar\\.|Apr\\.|Jun\\.|Jul\\.|Aug\\.|Sept?\\.|Oct\\.|Nov\\.|Dec\\.';
  const fullMonth = {jan:'January',feb:'February',mar:'March',apr:'April',jun:'June',jul:'July',aug:'August',sep:'September',sept:'September',oct:'October',nov:'November',dec:'December'};
  const monthName = m => fullMonth[m.replace('.', '').toLowerCase()] || m;
  const titles = [[/\bDr\.(?=\s+[A-Z])/g,'Doctor'],[/\bMrs\.(?=\s+[A-Z])/g,'Missus'],[/\bMr\.(?=\s+[A-Z])/g,'Mister'],[/\bMs\.(?=\s+[A-Z])/g,'Miz'],[/\bProf\.(?=\s+[A-Z])/g,'Professor'],[/\bRev\.(?=\s+[A-Z])/g,'Reverend'],[/\bFr\.(?=\s+[A-Z])/g,'Father'],[/\bSt\.(?=\s+[A-Z])/g,'Saint'],[/\bMt\.(?=\s+[A-Z])/g,'Mount'],[/\bJr\./g,'Junior']];
  function spoken(input) {
    let text = String(input ?? '');
    if (!/[0-9&%$.]/.test(text)) return text;
    for (const [pattern, word] of titles) text = text.replace(pattern, word);
    text = text.replace(/\be\.g\.,?/gi, 'for example,').replace(/\bi\.e\.,?/gi, 'that is,').replace(/\betc\./gi, 'et cetera.').replace(/\bvs\.(?=\s)/gi, 'versus').replace(/\bNo\.\s*(?=\d)/g, 'number ');
    // Initials: "R.A." -> "R. A." so each letter is said on its own.
    text = text.replace(/\b((?:[A-Z]\.){2,})/g, letters => letters.split('.').filter(Boolean).join('. ') + '.');
    // Dates: "August 22, 2022" and "22 August 2022".
    text = text.replace(new RegExp(`\\b(${months})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:(,?\\s+)(\\d{4})\\b)?`, 'g'), (all, month, day, gap, yr) => {
      const d = Number(day); if (d < 1 || d > 31) return all;
      return `${monthName(month)} ${ordinal(d)}${yr ? gap + year(Number(yr)) : ''}`;
    });
    text = text.replace(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${months})(?:,?\\s+(\\d{4})\\b)?`, 'g'), (all, day, month, yr) => {
      const d = Number(day); if (d < 1 || d > 31) return all;
      return `the ${ordinal(d)} of ${monthName(month)}${yr ? ' ' + year(Number(yr)) : ''}`;
    });
    // Money and percentages.
    text = text.replace(/\$(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?\b/g, (all, whole, cents) => { const n = Number(whole.replace(/,/g, '')); return cardinal(n) + (n === 1 ? ' dollar' : ' dollars') + (cents && Number(cents) ? ' ' + cardinal(Number(cents)) + ' cents' : ''); });
    text = text.replace(/(\d)\s?%/g, '$1 percent');
    // Ordinals (21st), decades (1960s), ranges (11-15) and years.
    text = text.replace(/\b(\d+)(st|nd|rd|th)\b/g, (all, n) => ordinal(Number(n)));
    text = text.replace(/\b(1[1-9]|20)(\d0)s\b/g, (all, c, d) => { const w = year(Number(c + d)); return w.endsWith('y') ? w.slice(0, -1) + 'ies' : w + 's'; });
    text = text.replace(/\b(\d+)\s?[–-]\s?(\d+)\b/g, (all, a, b) => `${a} to ${b}`);
    text = text.replace(/(^|[^\d.,:/$])((?:1[1-9]|20)\d\d)(?![\d]|[,.]\d|\s?percent)/g, (all, lead, y) => lead + year(Number(y)));
    // Times: 10:30 -> ten thirty.
    text = text.replace(/\b(\d{1,2}):(\d{2})\b/g, (all, h, m) => Number(h) < 24 && Number(m) < 60 ? cardinal(Number(h)) + (Number(m) ? ' ' + (Number(m) < 10 ? 'oh ' + ones[Number(m)] : under100(Number(m))) : " o'clock") : all);
    // Other numbers: 5,000 / 3.5 / 42.
    text = text.replace(/\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d+\.\d+\b|\b\d+\b/g, number => {
      const [whole, fraction] = number.replace(/,/g, '').split('.'), n = Number(whole);
      if (!Number.isSafeInteger(n) || whole.length > 15) return number;
      return cardinal(n) + (fraction ? ' point ' + [...fraction].map(d => ones[Number(d)]).join(' ') : '');
    });
    return text.replace(/\s&\s/g, ' and ');
  }
  return {spoken, cardinal, ordinal, year};
})();
