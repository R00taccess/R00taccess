'use strict';
/*
 * Minimal ANSI -> HTML converter for the Terminal Quest renderer.
 * Handles SGR colour/bold/inverse codes and the clear-screen sequence.
 */

const COLORS = {
  30: '#000000', 31: '#ff5555', 32: '#00ff66', 33: '#ffcc00', 34: '#5599ff',
  35: '#cc66ff', 36: '#33dddd', 37: '#cccccc', 90: '#888888', 91: '#ff8888',
  92: '#88ff88', 93: '#ffee88', 94: '#88bbff', 95: '#dd99ff', 96: '#88eeee', 97: '#ffffff'
};

function esc(s) {
  return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// Returns { html, clear } — clear=true means the buffer should be wiped first.
function ansiToHtml(text) {
  let clear = false;
  // handle clear screen sequences
  text = text.replace(/\x1b\[2J\x1b\[H|\x1b\[2J|\x1b\[H/g, () => { clear = true; return ''; });
  let html = '';
  let state = { fg: null, bold: false, inverse: false };
  const span = (chunk) => {
    if (!chunk) return '';
    let fg = state.fg;
    let styles = '';
    if (state.bold) styles += 'font-weight:700;';
    if (state.inverse) {
      styles += `background:${fg || '#00ff66'};color:#000;`;
    } else if (fg) {
      styles += `color:${fg};`;
    }
    if (state.bold && !fg && !state.inverse) styles += 'color:#eaffea;';
    return styles ? `<span style="${styles}">${esc(chunk)}</span>` : esc(chunk);
  };
  let i = 0;
  let buf = '';
  while (i < text.length) {
    if (text[i] === '\x1b' && text[i + 1] === '[') {
      html += span(buf); buf = '';
      const m = /^\x1b\[([0-9;]*)m/.exec(text.slice(i));
      if (m) {
        const codes = m[1].split(';').filter(x => x !== '').map(Number);
        if (codes.length === 0) codes.push(0);
        for (const c of codes) {
          if (c === 0) state = { fg: null, bold: false, inverse: false };
          else if (c === 1) state.bold = true;
          else if (c === 7) state.inverse = true;
          else if (c === 22) state.bold = false;
          else if (c === 27) state.inverse = false;
          else if (c === 39) state.fg = null;
          else if (COLORS[c]) state.fg = COLORS[c];
        }
        i += m[0].length;
        continue;
      }
      // unknown escape — skip the ESC
      i++;
      continue;
    }
    buf += text[i++];
  }
  html += span(buf);
  return { html, clear };
}

module.exports = { ansiToHtml, esc };
