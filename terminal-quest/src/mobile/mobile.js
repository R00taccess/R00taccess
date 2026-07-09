'use strict';
/*
 * Terminal Quest — Android input bridge.
 * Android soft keyboards don't deliver reliable keydown events to a plain div,
 * so we route typing through a hidden <input> (its input events are reliable)
 * and provide a toolbar for the keys a phone keyboard can't produce
 * (Ctrl, Tab, arrows, pipes). Everything funnels into window.TQ, which drives
 * the same code paths as physical typing on desktop.
 */
(function () {
  var soft = document.getElementById('softkb');
  var screen = document.getElementById('screen');
  var keybar = document.getElementById('keybar');
  var ctrlBtn = document.getElementById('kb-ctrl');
  var ctrlArmed = false;

  // The sentinel keeps one character in the field so Backspace always
  // produces a detectable value change even at "empty".
  var SENTINEL = ' ';
  function reset() { soft.value = SENTINEL; try { soft.setSelectionRange(1, 1); } catch (e) {} }
  reset();

  function focusSoft() {
    // focusing the hidden input summons the Android keyboard
    soft.focus({ preventScroll: true });
    reset();
  }

  // tapping the terminal (but not selecting text) opens the keyboard
  screen.addEventListener('click', function () {
    if (!String(window.getSelection && window.getSelection())) focusSoft();
    else if (!window.getSelection().toString()) focusSoft();
  });
  // keep it available immediately on launch
  window.addEventListener('load', function () { setTimeout(focusSoft, 300); });

  soft.addEventListener('input', function () {
    var v = soft.value;
    if (v === SENTINEL) return;
    if (v.length < SENTINEL.length || v.indexOf(SENTINEL) === -1) {
      // sentinel destroyed -> a backspace happened
      window.TQ.pressKey('Backspace');
    } else {
      var typed = v.replace(SENTINEL, '');
      if (typed) {
        if (ctrlArmed && typed.length === 1) {
          window.TQ.pressKey(typed, { ctrl: true });
          disarmCtrl();
        } else {
          window.TQ.insertText(typed);
        }
      }
    }
    reset();
  });

  // Enter / Backspace on keyboards that do fire keydown (incl. physical ones)
  soft.addEventListener('keydown', function (e) {
    var handled = ['Enter', 'Backspace', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];
    if (e.key === 'Unidentified') return; // soft keyboard noise; input event covers it
    if (handled.indexOf(e.key) !== -1) {
      e.preventDefault();
      window.TQ.pressKey(e.key, { ctrl: e.ctrlKey });
      reset();
    } else if (e.ctrlKey && e.key.length === 1) {
      e.preventDefault();
      window.TQ.pressKey(e.key, { ctrl: true });
    }
  });

  function disarmCtrl() { ctrlArmed = false; ctrlBtn.classList.remove('armed'); }

  keybar.addEventListener('click', function (ev) {
    var b = ev.target.closest('button');
    if (!b) return;
    ev.preventDefault();
    if (b.id === 'kb-ctrl') {
      ctrlArmed = !ctrlArmed;
      ctrlBtn.classList.toggle('armed', ctrlArmed);
      focusSoft();
      return;
    }
    if (b.dataset.text) {
      window.TQ.insertText(b.dataset.text);
    } else if (b.dataset.key) {
      if (ctrlArmed && b.dataset.key.length === 1) {
        window.TQ.pressKey(b.dataset.key, { ctrl: true });
        disarmCtrl();
      } else {
        window.TQ.pressKey(b.dataset.key);
      }
    }
    focusSoft();
  });

  // keep taps on the toolbar from stealing focus (which would close the keyboard)
  keybar.addEventListener('mousedown', function (e) { e.preventDefault(); });
  keybar.addEventListener('touchstart', function (e) { /* allow click, keep focus */ }, { passive: true });
})();
