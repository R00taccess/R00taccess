'use strict';
/*
 * Minimal ANSI -> HTML converter for the Terminal Quest renderer.
 * Handles SGR colour/bold/inverse codes and the clear-screen sequence.
 */

const COLORS = {
  30: '#04120a', 31: '#ff6b6b', 32: '#35f58e', 33: '#ffc247', 34: '#7fb0ff',
  35: '#c78bff', 36: '#5fd6ff', 37: '#cfe8da', 90: '#7d9488', 91: '#ff9a9a',
  92: '#8dffb8', 93: '#ffe08a', 94: '#a8c8ff', 95: '#dcb0ff', 96: '#a6ecff', 97: '#ffffff'
};

function esc(s) {
  return s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

// xterm 256-colour index -> hex
function xterm256(n) {
  if (n < 16) return COLORS[n < 8 ? 30 + n : 82 + n] || '#cccccc';
  if (n <= 231) {
    n -= 16;
    const levels = [0, 95, 135, 175, 215, 255];
    const r = levels[Math.floor(n / 36) % 6];
    const g = levels[Math.floor(n / 6) % 6];
    const b = levels[n % 6];
    return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
  }
  const v = 8 + (n - 232) * 10;
  return '#' + [v, v, v].map(x => x.toString(16).padStart(2, '0')).join('');
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
      styles += `background:${fg || '#35f58e'};color:#031007;`;
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
        for (let k = 0; k < codes.length; k++) {
          const c = codes[k];
          if (c === 0) state = { fg: null, bold: false, inverse: false };
          else if (c === 1) state.bold = true;
          else if (c === 7) state.inverse = true;
          else if (c === 22) state.bold = false;
          else if (c === 27) state.inverse = false;
          else if (c === 39) state.fg = null;
          else if (c === 38 || c === 48) {
            // extended colour: 38;2;r;g;b (truecolor) or 38;5;n (256)
            const target = c === 38 ? 'fg' : 'bg';
            if (codes[k + 1] === 2) {
              const [r, g, b] = [codes[k + 2] || 0, codes[k + 3] || 0, codes[k + 4] || 0];
              const hex = '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
              if (target === 'fg') state.fg = hex;
              k += 4;
            } else if (codes[k + 1] === 5) {
              state.fg = xterm256(codes[k + 2] || 0);
              k += 2;
            }
          }
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
