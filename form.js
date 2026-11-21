// Public submission form. Sends one row to the "submissions" table.
// The database decides the status (approved, flagged, or rejected) and assigns the similar-problem group.
(function () {
  'use strict';
  var PB = window.PB, $ = PB.$;
  var loadedAt = Date.now();

  if (!PB.configured || !PB.client) $('#config-warning').hidden = false;

  var form = $('#submit-form');
  var descBox = $('#f-desc');
  descBox.addEventListener('input', function () { $('#desc-count').textContent = descBox.value.length; });

  function radio(name) {
    var el = form.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : null;
  }
  function showError(msg) {
    var e = $('#form-error');
    e.textContent = msg;
    e.hidden = !msg;
  }
  function orNull(v) { v = (v || '').trim(); return v ? v : null; }

  form.addEventListener('submit', async function (ev) {
    ev.preventDefault();
    showError('');
    if (!PB.client) { showError('This form is not connected to Supabase yet. See js/config.js.'); return; }

    var title = $('#f-title').value.trim();
    var desc = descBox.value.trim();
    var category = $('#f-cat').value;
    var pain = radio('pain');
    var frequency = radio('frequency');
    var email = orNull($('#f-email').value);

    var tip = window.PBMod.precheck(title, desc);
    if (tip) { showError(tip); return; }
    if (!category) { showError('Please choose which part of life this is.'); return; }
    if (!pain) { showError('Please say how much it bothers you.'); return; }
    if (!frequency) { showError('Please say how often it happens.'); return; }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { showError('That email address does not look right.'); return; }
    if (!$('#f-consent').checked) { showError('Please tick the box to confirm you agree.'); return; }

    var btn = $('#send-btn');
    btn.disabled = true;
    var row = {
      title: title,
      description: desc,
      category: category,
      pain: parseInt(pain, 10),
      frequency: frequency,
      workaround: orNull($('#f-workaround').value),
      would_use: radio('would_use') || 'maybe',
      age_range: orNull($('#f-age').value),
      location: orNull($('#f-loc').value),
      contact_email: email,
      consent: true,
      website: $('#f-website').value,          // honeypot: real people leave it empty
      fill_ms: Date.now() - loadedAt            // bots tend to submit instantly
    };

    // No .select() on purpose: the public role may insert but never read.
    var res = await PB.client.from('submissions').insert(row);
    btn.disabled = false;

    if (res.error) {
      var m = (res.error.message || '').toLowerCase();
      if (m.indexOf('rate_limited') !== -1) {
        showError('You have sent several problems in a short time. Please come back in an hour.');
      } else {
        showError('Something went wrong and your problem was not saved. Please try again in a moment.');
        console.error(res.error);
      }
      return;
    }
    form.hidden = true;
    $('#thanks').hidden = false;
    window.scrollTo({ top: 0 });
  });

  $('#another-btn').addEventListener('click', function () {
    form.reset();
    $('#desc-count').textContent = '0';
    loadedAt = Date.now();
    $('#thanks').hidden = true;
    form.hidden = false;
    $('#f-title').focus();
  });
})();
