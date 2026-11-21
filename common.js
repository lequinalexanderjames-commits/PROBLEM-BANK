// Shared helpers and the Supabase client. Loaded by both index.html and admin.html.
(function () {
  'use strict';
  var C = window.PROBLEM_BANK_CONFIG || {};
  var configured = !!(C.SUPABASE_URL && C.SUPABASE_ANON_KEY &&
    C.SUPABASE_URL.indexOf('YOUR-') === -1 && C.SUPABASE_ANON_KEY.indexOf('YOUR-') === -1);

  var client = null;
  if (configured && window.supabase && window.supabase.createClient) {
    client = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
  }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  var toastTimer;
  function toast(msg) {
    var t = document.getElementById('toast');
    if (!t) return;
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('on'); }, 2400);
  }

  function fmtDate(iso) {
    try { return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }); }
    catch (e) { return ''; }
  }

  window.PB = { configured: configured, client: client, $: $, $$: $$, esc: esc, toast: toast, fmtDate: fmtDate };
})();
