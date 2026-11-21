// Admin dashboard: groups of similar problems, moderation queue, plan, settings.
// All data access goes through Supabase Row Level Security, so only users listed in public.admins can read anything.
(function () {
  'use strict';
  var PB = window.PB, $ = PB.$, $$ = PB.$$, esc = PB.esc, toast = PB.toast, db = PB.client;

  var BASE_SKILLS = ['Python', 'Java', 'C / C++', 'JavaScript / TypeScript', 'HTML and CSS', 'SQL and databases',
    'Data structures and algorithms', 'Machine learning', 'Web backend and APIs', 'Mobile apps', 'Networking',
    'Cybersecurity', 'UI and UX design', 'Data analysis', 'Automation and scripting', 'Cloud basics', 'Git'];
  var DEFAULT_SKILLS = ['Python', 'JavaScript / TypeScript', 'SQL and databases', 'Git'];
  var STATUSES = ['idea', 'validating', 'prototyping', 'parked'];
  var STATUS_LABEL = { idea: 'Idea', validating: 'Validating', prototyping: 'Prototyping', parked: 'Parked' };
  var FREQ_LABEL = { rarely: 'rarely', monthly: 'monthly', weekly: 'weekly', daily: 'daily' };
  var NEXT = {
    idea: 'Contact the people who left an email and ask how they handle this today. Aim for five conversations.',
    validating: 'Count how often it happens over one week and collect three direct quotes you can share.',
    prototyping: 'Ship the smallest working version to three people from this group and watch them use it.'
  };

  var S = {
    uid: null, skills: [], clusters: [], mod: [], modTab: 'flagged',
    cfg: null, terms: [], banned: [], stats: { voices: 0, flagged: 0, rejected: 0 }, open: {}
  };

  // ---------- helpers ----------
  async function q(promise) {
    var r = await promise;
    if (r.error) throw r.error;
    return r.data;
  }
  function fail(e) {
    console.error(e);
    toast('Something went wrong: ' + (e && e.message ? e.message : e));
  }
  function cardOf(el) { return el.closest('.cluster'); }
  function armed(btn) {
    // two-click confirm for anything destructive
    if (btn.dataset.armed) return true;
    btn.dataset.armed = '1';
    btn.dataset.label = btn.textContent;
    btn.textContent = 'Click again to confirm';
    btn.classList.add('danger');
    setTimeout(function () {
      if (btn.isConnected && btn.dataset.armed) {
        delete btn.dataset.armed;
        btn.textContent = btn.dataset.label;
        btn.classList.remove('danger');
      }
    }, 4000);
    return false;
  }
  function reachOf(v) { return Math.min(5, 1 + Math.log(Math.max(v, 1)) / Math.log(2)); }
  // Keep in sync with the cluster_summary view in supabase/schema.sql
  function priority(c) {
    return Math.round((c.avg_pain * 2 + c.avg_freq * 1.5 + c.fit * 2 + reachOf(c.voices) + c.demand * 1.5) / 40 * 100);
  }
  function allSkills() {
    var out = BASE_SKILLS.slice();
    S.skills.forEach(function (s) { if (out.indexOf(s) < 0) out.push(s); });
    S.clusters.forEach(function (c) { (c.needs || []).forEach(function (s) { if (out.indexOf(s) < 0) out.push(s); }); });
    return out;
  }
  function chip(label, pressed, attr) {
    return '<button type="button" class="chip" aria-pressed="' + pressed + '" ' + attr + '="' + esc(label) + '"><span class="dot"></span>' + esc(label) + '</button>';
  }

  // ---------- auth ----------
  function show(id) {
    ['setup', 'login', 'app'].forEach(function (n) { $('#' + n).hidden = (n !== id); });
  }
  function showLogin(msg) {
    show('login');
    var e = $('#login-error');
    e.textContent = msg || '';
    e.hidden = !msg;
  }
  async function enter(user) {
    S.uid = user.id;
    var r = await db.from('admins').select('user_id').eq('user_id', user.id).maybeSingle();
    if (r.error || !r.data) {
      S.uid = null;
      await db.auth.signOut();
      showLogin('This account is not an admin yet. Run the last step in supabase/schema.sql, then sign in again.');
      return;
    }
    show('app');
    try { await refreshAll(); } catch (e) { fail(e); }
    route();
  }

  $('#login-form').addEventListener('submit', async function (ev) {
    ev.preventDefault();
    var btn = $('#login-btn');
    btn.disabled = true;
    var r = await db.auth.signInWithPassword({ email: $('#l-email').value.trim(), password: $('#l-pass').value });
    btn.disabled = false;
    if (r.error) { showLogin('Sign in failed. Check your email and password.'); return; }
    $('#l-pass').value = '';
    await enter(r.data.user);
  });
  $('#signout').addEventListener('click', async function () {
    S.uid = null;
    await db.auth.signOut();
    showLogin('');
  });

  // ---------- loading ----------
  async function loadClusters() {
    S.clusters = (await q(db.from('cluster_summary').select('*').order('priority', { ascending: false }))) || [];
  }
  async function loadStats() {
    var a = await db.from('submissions').select('id', { count: 'exact', head: true }).eq('status', 'approved');
    var b = await db.from('submissions').select('id', { count: 'exact', head: true }).eq('status', 'flagged');
    var c = await db.from('submissions').select('id', { count: 'exact', head: true }).eq('status', 'rejected');
    S.stats = { voices: a.count || 0, flagged: b.count || 0, rejected: c.count || 0 };
  }
  async function loadSkills() {
    var r = await db.from('researcher_skills').select('skills').eq('user_id', S.uid).maybeSingle();
    S.skills = (r.data && Array.isArray(r.data.skills)) ? r.data.skills : DEFAULT_SKILLS.slice();
  }
  async function loadSettings() {
    S.cfg = await q(db.from('moderation_config').select('flag_at,reject_at,max_per_hour,similarity_threshold').eq('id', true).single());
    S.terms = (await q(db.from('blocked_terms').select('*').order('kind').order('term'))) || [];
    S.banned = (await q(db.from('banned_senders').select('*').order('created_at', { ascending: false }))) || [];
  }
  async function loadMod() {
    S.mod = (await q(db.from('submissions').select('*').in('status', ['flagged', 'rejected']).order('created_at', { ascending: false }).limit(200))) || [];
  }
  async function refreshAll() {
    await Promise.all([loadSkills(), loadClusters(), loadStats(), loadSettings(), loadMod()]);
    renderAll();
  }

  // ---------- render: stats ----------
  function renderStats() {
    $('#stats').innerHTML =
      '<div class="stat"><b>' + S.stats.voices + '</b><span>People heard</span></div>' +
      '<div class="stat"><b>' + S.clusters.length + '</b><span>Groups</span></div>' +
      '<div class="stat"><b>' + S.stats.flagged + '</b><span>Waiting for review</span></div>' +
      '<div class="stat"><b>' + S.stats.rejected + '</b><span>Blocked</span></div>';
    $('#n-groups').textContent = S.clusters.length;
    var f = $('#n-flagged');
    f.textContent = S.stats.flagged;
    f.classList.toggle('alert', S.stats.flagged > 0);
    $('#m-flagged').textContent = S.stats.flagged;
    $('#m-rejected').textContent = S.stats.rejected;
  }

  // ---------- render: groups ----------
  function bar(label, val, max) {
    var pct = Math.max(0, Math.min(100, Math.round(val / max * 100)));
    return '<div><div class="row"><span>' + label + '</span><span>' + Number(val).toFixed(1) + '</span></div><div class="meter"><i style="width:' + pct + '%"></i></div></div>';
  }
  function clusterHtml(c) {
    var statusOpts = STATUSES.map(function (s) { return '<option value="' + s + '"' + (s === c.status ? ' selected' : '') + '>' + STATUS_LABEL[s] + '</option>'; }).join('');
    var chips = allSkills().map(function (s) { return chip(s, (c.needs || []).indexOf(s) >= 0, 'data-need'); }).join('');
    var others = S.clusters.filter(function (x) { return x.id !== c.id; })
      .map(function (x) { return '<option value="' + x.id + '">' + esc(x.label.slice(0, 60)) + '</option>'; }).join('');
    return '<article class="cluster" data-id="' + c.id + '">' +
      '<div class="cluster-head"><div class="grow">' +
        '<input class="label-input" type="text" data-f="label" value="' + esc(c.label) + '" aria-label="Group name" maxlength="120">' +
        '<p class="meta">' + c.voices + (c.voices === 1 ? ' person' : ' people') + ' · ' + esc(c.top_category || '') + ' · last heard ' + esc(PB.fmtDate(c.last_seen)) +
          (c.contactable ? ' · ' + c.contactable + ' left an email' : '') + '</p></div>' +
        '<div class="scorebox"><b class="prio">' + c.priority + '</b><span>priority</span></div></div>' +
      '<div class="mini">' + bar('Pain', c.avg_pain, 5) + bar('How often', c.avg_freq, 5) + bar('Would use a fix', c.demand, 5) + bar('Reach', c.reach, 5) + '</div>' +
      '<div class="controls">' +
        '<div class="field"><label>Status</label><select data-f="status">' + statusOpts + '</select></div>' +
        '<div class="slider-row"><div class="head"><span>Skill fit</span><span class="fitval">' + c.fit + '</span></div>' +
          '<input type="range" min="1" max="5" value="' + c.fit + '" data-f="fit" aria-label="How well your skills fit"></div>' +
      '</div>' +
      '<div><span class="lab">Skills this would need</span><div class="chips" style="margin-top:8px">' + chips + '</div></div>' +
      '<div class="field"><label>Notes</label><textarea data-f="notes" placeholder="Interview plans, ideas, links">' + esc(c.notes || '') + '</textarea></div>' +
      '<details class="more" data-voices="' + c.id + '"' + (S.open[c.id] ? ' open' : '') + '><summary>What people said</summary><div class="voices"></div></details>' +
      '<div class="btnrow"><select data-merge-target aria-label="Merge into another group"><option value="">Merge this group into…</option>' + others + '</select>' +
        '<button type="button" class="btn ghost sm" data-merge>Merge</button></div>' +
      '</article>';
  }
  function renderClusters() {
    var st = $('#c-status').value, term = $('#c-search').value.trim().toLowerCase();
    var list = S.clusters.filter(function (c) {
      return (!st || c.status === st) && (!term || c.label.toLowerCase().indexOf(term) !== -1);
    });
    var box = $('#cluster-list');
    if (!list.length) {
      box.innerHTML = '<div class="empty">' + (S.clusters.length ? 'No groups match these filters.' :
        'No responses yet. Share the public form, or run supabase/seed_sample.sql to see sample data.') + '</div>';
      return;
    }
    box.innerHTML = list.map(clusterHtml).join('');
    Object.keys(S.open).forEach(function (id) { if (S.open[id]) loadVoices(id); });
  }

  async function loadVoices(id) {
    var d = document.querySelector('details[data-voices="' + id + '"]');
    if (!d) return;
    var box = d.querySelector('.voices');
    box.innerHTML = '<p class="hint">Loading…</p>';
    try {
      var rows = await q(db.from('submissions').select('id,title,description,pain,frequency,would_use,location,contact_email,created_at')
        .eq('cluster_id', id).eq('status', 'approved').order('created_at', { ascending: false }));
      var others = S.clusters.filter(function (x) { return x.id !== id; })
        .map(function (x) { return '<option value="' + x.id + '">' + esc(x.label.slice(0, 60)) + '</option>'; }).join('');
      box.innerHTML = rows.map(function (r) {
        return '<div class="voice" data-sid="' + r.id + '">' +
          '<b>' + esc(r.title) + '</b><p class="quote">' + esc(r.description) + '</p>' +
          '<p class="meta">Pain ' + r.pain + '/5 · ' + FREQ_LABEL[r.frequency] + ' · would use: ' + esc(r.would_use) +
            (r.location ? ' · ' + esc(r.location) : '') + ' · ' + esc(PB.fmtDate(r.created_at)) +
            (r.contact_email ? ' · ' + esc(r.contact_email) : '') + '</p>' +
          '<div class="btnrow"><select data-move aria-label="Move to another group"><option value="">Move to…</option><option value="__new">A new group</option>' + others + '</select>' +
          '<button type="button" class="btn ghost sm" data-reject-voice>Reject</button></div></div>';
      }).join('') || '<p class="hint">Nothing here.</p>';
    } catch (e) { fail(e); }
  }

  async function updateCluster(id, patch) {
    try {
      await q(db.from('clusters').update(patch).eq('id', id));
      var c = S.clusters.find(function (x) { return x.id === id; });
      Object.assign(c, patch);
      c.priority = priority(c);
      var el = document.querySelector('.cluster[data-id="' + id + '"] .prio');
      if (el) el.textContent = c.priority;
      toast('Saved');
    } catch (e) { fail(e); }
  }
  async function reloadGroups() {
    await Promise.all([loadClusters(), loadStats()]);
    renderStats();
    renderClusters();
    renderPlan();
  }

  var cl = $('#cluster-list');
  cl.addEventListener('change', async function (e) {
    var t = e.target, card = cardOf(t);
    if (t.matches('[data-move]')) {
      var sid = t.closest('.voice').dataset.sid, to = t.value;
      if (!to) return;
      try {
        if (to === '__new') {
          var title = t.closest('.voice').querySelector('b').textContent;
          var created = await q(db.from('clusters').insert({ label: title.slice(0, 90) }).select('id').single());
          to = created.id;
        }
        await q(db.from('submissions').update({ cluster_id: to }).eq('id', sid));
        await q(db.rpc('prune_empty_clusters'));
        toast('Moved');
        await reloadGroups();
      } catch (err) { fail(err); }
      return;
    }
    if (!card) return;
    var id = card.dataset.id, f = t.dataset.f;
    if (f === 'label') {
      var v = t.value.trim();
      if (v) updateCluster(id, { label: v.slice(0, 120) });
    } else if (f === 'notes') {
      updateCluster(id, { notes: t.value.trim() || null });
    } else if (f === 'status') {
      updateCluster(id, { status: t.value });
    } else if (f === 'fit') {
      updateCluster(id, { fit: parseInt(t.value, 10) });
    }
  });
  cl.addEventListener('input', function (e) {
    if (e.target.dataset.f === 'fit') cardOf(e.target).querySelector('.fitval').textContent = e.target.value;
  });
  cl.addEventListener('click', async function (e) {
    var b;
    if ((b = e.target.closest('[data-need]'))) {
      var card = cardOf(b), id = card.dataset.id, s = b.getAttribute('data-need');
      var c = S.clusters.find(function (x) { return x.id === id; });
      var needs = (c.needs || []).slice(), i = needs.indexOf(s);
      if (i >= 0) needs.splice(i, 1); else needs.push(s);
      b.setAttribute('aria-pressed', i < 0);
      updateCluster(id, { needs: needs });
    } else if ((b = e.target.closest('[data-merge]'))) {
      var from = cardOf(b).dataset.id, into = cardOf(b).querySelector('[data-merge-target]').value;
      if (!into) { toast('Choose a group to merge into'); return; }
      if (!armed(b)) return;
      try {
        await q(db.rpc('merge_clusters', { from_id: from, into_id: into }));
        toast('Groups merged');
        await reloadGroups();
      } catch (err) { fail(err); }
    } else if ((b = e.target.closest('[data-reject-voice]'))) {
      var sid = b.closest('.voice').dataset.sid;
      if (!armed(b)) return;
      try {
        await q(db.from('submissions').update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: S.uid }).eq('id', sid));
        await q(db.rpc('prune_empty_clusters'));
        toast('Rejected');
        await Promise.all([loadMod(), reloadGroups()]);
        renderMod();
      } catch (err) { fail(err); }
    }
  });
  // <details> toggle does not bubble, so listen in the capture phase
  cl.addEventListener('toggle', function (e) {
    var d = e.target;
    if (!d.matches || !d.matches('details[data-voices]')) return;
    var id = d.dataset.voices;
    S.open[id] = d.open;
    if (d.open) loadVoices(id);
  }, true);
  $('#c-status').addEventListener('change', renderClusters);
  $('#c-search').addEventListener('input', renderClusters);

  // ---------- render: all responses ----------
  var inboxTimer;
  async function loadInbox() {
    var box = $('#inbox-list');
    box.innerHTML = '<div class="empty">Loading…</div>';
    try {
      var qb = db.from('submissions').select('id,title,description,category,pain,frequency,would_use,location,created_at,cluster_id')
        .eq('status', 'approved').order('created_at', { ascending: false }).limit(300);
      var cat = $('#i-cat').value, term = $('#i-search').value.trim().replace(/[%,()]/g, ' ');
      if (cat) qb = qb.eq('category', cat);
      if (term) qb = qb.or('title.ilike.%' + term + '%,description.ilike.%' + term + '%');
      var rows = await q(qb);
      var names = {};
      S.clusters.forEach(function (c) { names[c.id] = c.label; });
      box.innerHTML = rows.map(function (r) {
        return '<article class="item"><div><h3>' + esc(r.title) + '</h3><p class="meta">' + esc(r.category) + ' · ' + esc(PB.fmtDate(r.created_at)) +
          (r.location ? ' · ' + esc(r.location) : '') + '</p></div>' +
          '<div class="scorebox"><b>' + r.pain + '</b><span>pain</span></div>' +
          '<div class="body"><p>' + esc(r.description) + '</p></div>' +
          '<div class="foot"><div class="pills"><span class="pill">' + FREQ_LABEL[r.frequency] + '</span><span class="pill">would use: ' + esc(r.would_use) + '</span>' +
          (names[r.cluster_id] ? '<span class="pill ok">' + esc(names[r.cluster_id].slice(0, 50)) + '</span>' : '') + '</div></div></article>';
      }).join('') || '<div class="empty">No responses match.</div>';
    } catch (e) { fail(e); }
  }
  $('#i-search').addEventListener('input', function () { clearTimeout(inboxTimer); inboxTimer = setTimeout(loadInbox, 300); });
  $('#i-cat').addEventListener('change', loadInbox);

  // ---------- render: moderation ----------
  function renderMod() {
    var list = S.mod.filter(function (m) { return m.status === S.modTab; });
    $$('[data-mod]').forEach(function (b) { b.setAttribute('aria-pressed', b.dataset.mod === S.modTab); });
    var box = $('#mod-list');
    if (!list.length) {
      box.innerHTML = '<div class="empty">' + (S.modTab === 'flagged' ? 'Nothing is waiting for review.' : 'No blocked messages.') + '</div>';
      return;
    }
    box.innerHTML = list.map(function (m) {
      var flags = (m.flags || []).map(function (f) { return '<span class="pill ' + (/^(threat|spam|banned|honeypot|directed)/.test(f) ? 'bad' : 'warn') + '">' + esc(f) + '</span>'; }).join('');
      return '<article class="item" data-id="' + m.id + '" data-hash="' + esc(m.sender_hash || '') + '">' +
        '<div><h3>' + esc(m.title) + '</h3><p class="meta">' + esc(m.category) + ' · ' + esc(PB.fmtDate(m.created_at)) +
          (m.sender_hash ? ' · sender ' + esc(m.sender_hash.slice(0, 8)) : '') + '</p></div>' +
        '<div class="scorebox"><b>' + m.toxicity + '</b><span>risk</span></div>' +
        '<div class="body"><p style="white-space:pre-wrap">' + esc(m.description) + '</p>' +
          (m.workaround ? '<p class="meta">Today: ' + esc(m.workaround) + '</p>' : '') + '</div>' +
        '<div class="foot"><div class="pills">' + flags + '</div><div class="btnrow">' +
          (m.status !== 'approved' ? '<button type="button" class="btn sm" data-act="approve">Approve</button>' : '') +
          (m.status === 'flagged' ? '<button type="button" class="btn ghost sm" data-act="reject">Reject</button>' : '') +
          (m.sender_hash ? '<button type="button" class="btn ghost sm" data-act="ban">Ban sender</button>' : '') +
          '<button type="button" class="btn ghost sm" data-act="delete">Delete</button></div></div></article>';
    }).join('');
  }
  $$('[data-mod]').forEach(function (b) {
    b.addEventListener('click', function () { S.modTab = b.dataset.mod; renderMod(); });
  });
  $('#mod-list').addEventListener('click', async function (e) {
    var b = e.target.closest('[data-act]');
    if (!b) return;
    var card = b.closest('.item'), id = card.dataset.id, hash = card.dataset.hash, act = b.dataset.act;
    if ((act === 'ban' || act === 'delete') && !armed(b)) return;
    try {
      if (act === 'approve') {
        // The database trigger puts the response into the most similar group
        await q(db.from('submissions').update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_by: S.uid }).eq('id', id));
        toast('Approved and grouped');
      } else if (act === 'reject') {
        await q(db.from('submissions').update({ status: 'rejected', reviewed_at: new Date().toISOString(), reviewed_by: S.uid }).eq('id', id));
        toast('Rejected');
      } else if (act === 'delete') {
        await q(db.from('submissions').delete().eq('id', id));
        toast('Deleted');
      } else if (act === 'ban') {
        await q(db.from('banned_senders').upsert({ sender_hash: hash, reason: 'Banned from the moderation queue' }));
        await q(db.from('submissions').update({ status: 'rejected' }).eq('sender_hash', hash).neq('status', 'rejected'));
        toast('Sender banned and their messages rejected');
        await loadSettings();
        renderSettings();
      }
      await q(db.rpc('prune_empty_clusters'));
      await Promise.all([loadMod(), loadClusters(), loadStats()]);
      renderStats(); renderMod(); renderClusters(); renderPlan();
    } catch (err) { fail(err); }
  });

  // ---------- render: plan ----------
  function ranked() {
    return S.clusters.filter(function (c) { return c.status !== 'parked'; })
      .sort(function (a, b) { return b.priority - a.priority; });
  }
  function renderProfile() {
    $('#profile-chips').innerHTML = allSkills().map(function (s) { return chip(s, S.skills.indexOf(s) >= 0, 'data-skill'); }).join('');
  }
  async function saveSkills() {
    try { await q(db.from('researcher_skills').upsert({ user_id: S.uid, skills: S.skills })); }
    catch (e) { fail(e); }
  }
  $('#profile-chips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-skill]');
    if (!b) return;
    var s = b.getAttribute('data-skill'), i = S.skills.indexOf(s);
    if (i >= 0) S.skills.splice(i, 1); else S.skills.push(s);
    saveSkills(); renderProfile(); renderPlan();
  });
  $('#skill-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('#skill-new').value.trim();
    if (!v) return;
    var exists = allSkills().some(function (s) { return s.toLowerCase() === v.toLowerCase(); });
    if (!exists) { S.skills.push(v); saveSkills(); renderProfile(); renderPlan(); toast('Skill added'); }
    else toast('That skill is already listed');
    $('#skill-new').value = '';
  });

  function renderPlan() {
    renderProfile();
    var r = ranked(), top = r.slice(0, 3);
    $('#picks').innerHTML = top.length ? top.map(function (c, i) {
      return '<div class="pick"><span class="rank">#' + (i + 1) + '</span><div style="min-width:0"><h3>' + esc(c.label) + '</h3>' +
        '<p class="meta">' + c.voices + (c.voices === 1 ? ' person' : ' people') + ' · ' + STATUS_LABEL[c.status] +
        (c.contactable ? ' · ' + c.contactable + ' can be contacted' : '') + '</p></div>' +
        '<div class="scorebox"><b>' + c.priority + '</b><span>priority</span></div>' +
        '<div class="next"><b>Next step</b>' + esc(NEXT[c.status]) + '</div></div>';
    }).join('') : '<div class="empty" style="margin-top:12px">Nothing to rank yet. Responses will appear here once people start sending problems.</div>';

    var first = r[0];
    $('#road-title').textContent = first ? first.label : 'Roadmap';
    var phases = [
      ['Weeks 1 to 2', 'Validate', 'Talk to five people from this group, record what they do today, and decide if the pain is real.'],
      ['Weeks 3 to 4', 'Prototype', 'Build the smallest version that solves one step of the problem. Use ' + (first && first.needs && first.needs.length ? first.needs.join(', ') : 'the skills you already have') + '.'],
      ['Weeks 5 to 6', 'Pilot', 'Put it in front of three to five real users and fix whatever blocks them.'],
      ['Week 7 onward', 'Measure', 'Track one number, such as weekly users or minutes saved, then decide to grow, change, or stop.']
    ];
    $('#road-body').innerHTML = first ? phases.map(function (p) {
      return '<tr><td style="white-space:nowrap">' + p[0] + '</td><td><b>' + p[1] + '</b></td><td>' + esc(p[2]) + '</td></tr>';
    }).join('') : '<tr><td colspan="3" class="hint">Roadmap appears when there is a group to build.</td></tr>';

    var counts = {};
    r.forEach(function (c) { (c.needs || []).forEach(function (s) { counts[s] = (counts[s] || 0) + c.voices; }); });
    var keys = Object.keys(counts).sort(function (a, b) { return counts[b] - counts[a]; });
    var max = keys.length ? counts[keys[0]] : 1;
    $('#skill-bars').innerHTML = keys.length ? keys.map(function (s) {
      var gap = S.skills.indexOf(s) < 0;
      return '<div class="bar"><span>' + esc(s) + '</span><div class="meter"><i class="' + (gap ? 'gap' : '') + '" style="width:' + Math.round(counts[s] / max * 100) + '%"></i></div><span class="n">' + counts[s] + '</span></div>';
    }).join('') : '<p class="hint">Mark the skills each group needs on the Groups tab to see demand here.</p>';

    $('#export-text').value = toMarkdown();
  }
  function toMarkdown() {
    var lines = ['# Problem Bank: Future Development Plan', '', 'My skills: ' + (S.skills.join(', ') || 'none listed'),
      'People heard: ' + S.stats.voices, '', '## Ranked groups', ''];
    S.clusters.slice().sort(function (a, b) { return b.priority - a.priority; }).forEach(function (c, i) {
      lines.push((i + 1) + '. **' + c.label + '** (priority ' + c.priority + ', ' + STATUS_LABEL[c.status] + ')');
      lines.push('   - ' + c.voices + ' people, ' + (c.top_category || 'no category') + ', pain ' + Number(c.avg_pain).toFixed(1) + '/5, would use a fix ' + Number(c.demand).toFixed(1) + '/5');
      if (c.needs && c.needs.length) lines.push('   - Skills: ' + c.needs.join(', '));
      if (c.contactable) lines.push('   - ' + c.contactable + ' left an email for follow-up');
      if (c.notes) lines.push('   - Notes: ' + c.notes);
    });
    return lines.join('\n');
  }
  $('#export-copy').addEventListener('click', function () {
    var ta = $('#export-text');
    function fallback() { ta.focus(); ta.select(); toast('Text selected. Copy it with your keyboard.'); }
    try { navigator.clipboard.writeText(ta.value).then(function () { toast('Copied to clipboard'); }, fallback); }
    catch (err) { fallback(); }
  });

  // ---------- render: settings ----------
  function renderSettings() {
    if (!S.cfg) return;
    $('#s-flag').value = S.cfg.flag_at;
    $('#s-reject').value = S.cfg.reject_at;
    $('#s-rate').value = S.cfg.max_per_hour;
    $('#s-sim').value = S.cfg.similarity_threshold;
    $('#term-body').innerHTML = S.terms.map(function (t) {
      return '<tr data-id="' + t.id + '"><td>' + esc(t.term) + '</td><td><span class="pill ' + (t.kind === 'abuse' ? 'warn' : 'bad') + '">' + esc(t.kind) + '</span></td>' +
        '<td><input type="number" min="1" max="100" value="' + t.weight + '" data-weight style="width:80px" aria-label="Weight for ' + esc(t.term) + '"></td>' +
        '<td><button type="button" class="btn ghost sm" data-del-term>Remove</button></td></tr>';
    }).join('') || '<tr><td colspan="4" class="hint">No blocked terms.</td></tr>';
    $('#ban-body').innerHTML = S.banned.map(function (b) {
      return '<tr data-hash="' + esc(b.sender_hash) + '"><td><code>' + esc(b.sender_hash) + '</code></td><td>' + esc(PB.fmtDate(b.created_at)) +
        '</td><td><button type="button" class="btn ghost sm" data-unban>Unban</button></td></tr>';
    }).join('') || '<tr><td colspan="3" class="hint">No banned senders.</td></tr>';
  }
  $('#cfg-save').addEventListener('click', async function () {
    var flag = parseInt($('#s-flag').value, 10), rej = parseInt($('#s-reject').value, 10);
    var rate = parseInt($('#s-rate').value, 10), sim = parseFloat($('#s-sim').value);
    if (!(flag >= 1 && rej > flag && rej <= 100)) { toast('Reject must be higher than flag, and at most 100'); return; }
    if (!(rate >= 1)) { toast('Max per hour must be at least 1'); return; }
    if (!(sim >= 0.05 && sim <= 0.95)) { toast('Similarity must be between 0.05 and 0.95'); return; }
    try {
      await q(db.from('moderation_config').update({ flag_at: flag, reject_at: rej, max_per_hour: rate, similarity_threshold: sim }).eq('id', true));
      S.cfg = { flag_at: flag, reject_at: rej, max_per_hour: rate, similarity_threshold: sim };
      toast('Thresholds saved');
    } catch (e) { fail(e); }
  });
  $('#term-form').addEventListener('submit', async function (e) {
    e.preventDefault();
    var term = $('#t-term').value.trim().toLowerCase();
    var weight = parseInt($('#t-weight').value, 10);
    if (term.length < 2) { toast('Enter a word or phrase'); return; }
    if (!(weight >= 1 && weight <= 100)) { toast('Weight must be 1 to 100'); return; }
    try {
      await q(db.from('blocked_terms').insert({ term: term, weight: weight, kind: $('#t-kind').value }));
      $('#t-term').value = '';
      await loadSettings(); renderSettings(); toast('Term added');
    } catch (err) { fail(err.code === '23505' ? { message: 'That term is already listed' } : err); }
  });
  $('#term-body').addEventListener('change', async function (e) {
    if (!e.target.matches('[data-weight]')) return;
    var id = e.target.closest('tr').dataset.id, w = parseInt(e.target.value, 10);
    if (!(w >= 1 && w <= 100)) { toast('Weight must be 1 to 100'); return; }
    try { await q(db.from('blocked_terms').update({ weight: w }).eq('id', id)); toast('Saved'); } catch (err) { fail(err); }
  });
  $('#term-body').addEventListener('click', async function (e) {
    if (!e.target.matches('[data-del-term]')) return;
    try {
      await q(db.from('blocked_terms').delete().eq('id', e.target.closest('tr').dataset.id));
      await loadSettings(); renderSettings();
    } catch (err) { fail(err); }
  });
  $('#ban-body').addEventListener('click', async function (e) {
    if (!e.target.matches('[data-unban]')) return;
    try {
      await q(db.from('banned_senders').delete().eq('sender_hash', e.target.closest('tr').dataset.hash));
      await loadSettings(); renderSettings(); toast('Sender unbanned');
    } catch (err) { fail(err); }
  });
  $('#recluster').addEventListener('click', async function (e) {
    if (!armed(e.target)) return;
    try {
      await q(db.rpc('recluster_all'));
      toast('Groups rebuilt');
      await reloadGroups();
    } catch (err) { fail(err); }
  });

  // ---------- routing (hash names: clusters, inbox, moderation, plan, settings) ----------
  var VIEWS = ['clusters', 'inbox', 'moderation', 'plan', 'settings'];
  function route() {
    var v = location.hash.replace('#', '');
    if (VIEWS.indexOf(v) < 0) v = 'clusters';
    VIEWS.forEach(function (n) { $('#view-' + n).hidden = (n !== v); });
    $$('.tabs a').forEach(function (a) {
      if (a.dataset.view === v) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (v === 'inbox') loadInbox();
    if (v === 'moderation') renderMod();
  }
  window.addEventListener('hashchange', route);

  function renderAll() {
    renderStats(); renderClusters(); renderMod(); renderPlan(); renderSettings();
  }

  // ---------- start ----------
  (async function init() {
    if (!PB.configured || !db) { show('setup'); return; }
    var r = await db.auth.getSession();
    if (r.data && r.data.session) await enter(r.data.session.user);
    else showLogin('');
  })();
})();
