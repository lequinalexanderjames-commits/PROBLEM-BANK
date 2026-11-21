// Friendly pre-check that runs in the browser before a problem is sent.
// This is only for helping honest people fix mistakes. The real filter lives in the database
// (supabase/schema.sql), because anything in the browser can be bypassed.
//
// Design choice: mild swearing is NOT blocked here. A person describing a real frustration
// may curse, and the research needs that voice. The database holds such messages for human review.
(function () {
  'use strict';

  function precheck(title, desc) {
    var t = (title || '').trim();
    var d = (desc || '').trim();
    if (t.length < 8) return 'Please give your problem a short title of at least 8 characters.';
    if (d.length < 20) return 'Please add a little more detail, at least 20 characters.';

    var all = t + ' ' + d;
    if (/https?:\/\/|www\./i.test(all)) return 'Please leave out web links and describe the problem in your own words.';

    var letters = all.replace(/[^A-Za-z]/g, '').length;
    var upper = all.replace(/[^A-Z]/g, '').length;
    if (letters > 20 && upper / letters > 0.7) return 'Your message is mostly capital letters. Please turn off caps lock and try again.';

    if (/(.)\1{5,}/.test(all)) return 'Please avoid long runs of the same character.';
    return null;
  }

  window.PBMod = { precheck: precheck };
})();
