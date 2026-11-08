// Crash guard for the game loop and the page: one thrown error must never freeze the game,
// spam the console every frame, or fail silently.
// - The rAF loop always reschedules (try/finally). A throw ends that frame, so no further fixed
//   steps run in it.
// - Every error is counted. Each distinct error is logged once, with its stack, up to maxLogs.
//   A caught frame error is also passed once to reportError, so the browser (and browser tests
//   listening for page errors) still see it as uncaught.
// - After `threshold` failing frames in a row (or a boot failure) the game pauses and the fatal
//   handlers run (the "Something broke" panel).
// - Global error / unhandledrejection events feed the same counter.
// - onCrash(fn) is the hook for the opt-in Diagnostics crash reporter. Nothing is sent anywhere.
(function (root) {
  'use strict';
  // Browser noise that is not a game error (Chrome reports it through window.onerror).
  const BENIGN = /ResizeObserver loop/;

  function describeError(err) {
    if (err instanceof Error) return { message: err.message || err.name, stack: err.stack || '' };
    if (typeof err === 'string') return { message: err, stack: '' };
    try { return { message: String(err), stack: '' }; } catch (e) { return { message: 'Unknown error', stack: '' }; }
  }

  function emit(set, report) {
    Array.from(set).forEach(fn => {
      try { fn(report); } catch (e) { /* a broken listener must not take the guard down */ }
    });
  }

  function create(opts) {
    opts = opts || {};
    const threshold = Math.max(1, opts.threshold || 3);
    const maxLogs = Math.max(0, opts.maxLogs == null ? 5 : opts.maxLogs);
    const log = opts.log || function () { console.error.apply(console, arguments); };
    const nativeReport = typeof root.reportError === 'function' ? e => root.reportError(e) : null;
    const surface = opts.surface !== undefined ? opts.surface : nativeReport;
    const seen = new Set();
    const surfaced = new WeakSet();
    const listeners = new Set();
    const fatalHandlers = new Set();
    let logged = 0;

    const guard = {
      threshold: threshold,
      errors: 0,
      consecutive: 0,
      paused: false,
      suppressed: 0,
      frameOk() { guard.consecutive = 0; },
      report(err, source) {
        const d = describeError(err);
        if (source !== 'frame' && source !== 'boot' && BENIGN.test(d.message)) return;
        guard.errors++;
        guard.consecutive++;
        const firstFrame = d.stack.split('\n').find(l => /\d:\d/.test(l)) || '';
        const sig = d.message + '\n' + firstFrame;
        if (!seen.has(sig)) {
          seen.add(sig);
          if (logged < maxLogs) { logged++; log('[crash] ' + source + ':', err); }
          else guard.suppressed++;
          emit(listeners, { source: source, message: d.message, stack: d.stack, count: guard.errors, fatal: false });
          if (source === 'frame' && surface && typeof err === 'object' && err !== null) {
            surfaced.add(err);
            try { surface(err); } catch (e) { /* best effort */ }
          }
        }
        if (!guard.paused && (source === 'boot' || guard.consecutive >= threshold)) {
          guard.paused = true;
          const report = { source: source, message: d.message, stack: d.stack, count: guard.errors, fatal: true };
          emit(listeners, report);
          emit(fatalHandlers, report);
        }
      },
      // Lift a pause after a successful retry (a boot failure the player retried).
      resume() { guard.paused = false; guard.consecutive = 0; },
      onCrash(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      onFatal(fn) { fatalHandlers.add(fn); return () => fatalHandlers.delete(fn); },
      install(target) {
        const onError = e => {
          if (e.error && typeof e.error === 'object' && surfaced.has(e.error)) return;
          guard.report(e.error != null ? e.error : e.message, 'error');
        };
        const onRejection = e => guard.report(e.reason, 'unhandledrejection');
        target.addEventListener('error', onError);
        target.addEventListener('unhandledrejection', onRejection);
        return () => {
          target.removeEventListener('error', onError);
          target.removeEventListener('unhandledrejection', onRejection);
        };
      },
    };
    return guard;
  }

  // A rAF loop that survives exceptions: step(now) runs inside try/catch, the next frame is
  // always scheduled in finally, and nothing runs while the guard is paused.
  function frameLoop(step, guard, raf) {
    raf = raf || (cb => root.requestAnimationFrame(cb));
    const frame = now => {
      try {
        if (guard.paused) return;
        step(now);
        guard.frameOk();
      } catch (err) {
        guard.report(err, 'frame');
      } finally {
        raf(frame);
      }
    };
    return frame;
  }

  // The small "Something broke" panel, in the join-form style. Reload after a runtime crash;
  // Retry after a boot failure (onRetry, or a reload). All error text is set as text.
  function showPanel(report, opts) {
    opts = opts || {};
    const doc = opts.document || root.document;
    const old = doc.getElementById('crash');
    if (old) old.remove();
    const boot = report.source === 'boot';
    const box = doc.createElement('div');
    box.id = 'crash';
    box.setAttribute('role', 'alertdialog');
    box.setAttribute('aria-labelledby', 'crashTitle');
    const panel = doc.createElement('div');
    panel.className = 'panel';
    const title = doc.createElement('div');
    title.id = 'crashTitle';
    title.className = 'title';
    title.textContent = 'SOMETHING BROKE';
    const note = doc.createElement('div');
    note.className = 'note';
    note.textContent = boot ? 'The art could not load. Check your connection and retry.' : 'The game hit an error and paused. Reload to keep playing.';
    const pre = doc.createElement('pre');
    pre.textContent = report.stack && report.stack.indexOf(report.message) >= 0 ? report.stack : [report.message, report.stack].filter(Boolean).join('\n');
    const button = doc.createElement('button');
    button.type = 'button';
    button.textContent = boot ? 'RETRY' : 'RELOAD';
    button.addEventListener('click', () => {
      if (boot && opts.onRetry) { box.remove(); opts.onRetry(); } else root.location.reload();
    });
    panel.appendChild(title);
    panel.appendChild(note);
    panel.appendChild(pre);
    panel.appendChild(button);
    box.appendChild(panel);
    doc.body.appendChild(box);
    if (button.focus) button.focus();
    return box;
  }

  const shared = create();
  let retry = null;
  // Close a boot-failure panel and run the game again (Retry, or a retry key on the loading screen).
  function dismiss() {
    const box = root.document && root.document.getElementById('crash');
    if (box) box.remove();
    shared.resume();
  }
  // In the page this script loads first, so errors in every later script are counted too.
  if (typeof window !== 'undefined' && root.document) {
    shared.install(root);
    shared.onFatal(report => showPanel(report, { onRetry: retry && (() => { dismiss(); retry(); }) }));
  }
  const CrashGuard = {
    create: create,
    frameLoop: frameLoop,
    showPanel: showPanel,
    describeError: describeError,
    // The page-wide guard: the loop, the page listeners and the panel all share it.
    guard: shared,
    // What Retry runs after a boot failure (main.js: bootAssets). Without it, Retry reloads.
    setRetry: fn => { retry = fn; },
    dismiss: dismiss,
    // Hook for the opt-in Diagnostics crash reporter. Nothing is sent anywhere yet.
    onCrash: fn => shared.onCrash(fn),
  };
  root.CrashGuard = CrashGuard;
  if (typeof module !== 'undefined' && module.exports) module.exports = CrashGuard;
})(typeof window !== 'undefined' ? window : globalThis);
