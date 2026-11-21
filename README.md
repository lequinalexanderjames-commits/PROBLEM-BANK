# Problem Bank (Future Development Plan)

A research tool for finding real problems that regular, non-technical people have, so a CS student can choose what to build.

- **`index.html`** is the public form. Anyone can send a problem. No account, no jargon.
- **`admin.html`** is your private dashboard. It shows similar problems grouped and ranked, a moderation queue, your build plan, and settings.
- **Supabase** stores everything and does the work that must not run in a browser: troll filtering, rate limiting, and grouping similar problems.

It is plain HTML, CSS and JavaScript. There is nothing to build or install.

## How it works

```
Visitor fills the form  ->  Supabase insert (anon key, insert only)
                                   |
                       trigger: score the text for abuse and spam
                         clean      -> approved
                         borderline -> flagged  (waits for you)
                         obvious    -> rejected (hidden)
                                   |
                       trigger: find the most similar approved problem
                         close enough -> join its group
                         otherwise    -> start a new group
                                   |
              admin.html reads the ranked cluster_summary view
```

### Troll filter

All of this runs inside the database, so a troll cannot switch it off by editing the page.

| Check | What it catches |
| --- | --- |
| Blocked words and phrases, with weights | Profanity, threats, spam terms. Handles capitals, `@` for a, `fuuuuck`. Matches whole words, so "class" never trips "ass". |
| Directed insults | "you are an idiot", "u r so useless" |
| Links | Spam links and bare domains |
| Shouting, keyboard mashing, repeated words | Low effort noise |
| Honeypot field | Bots that fill in a hidden field |
| Fill time under 4 seconds | Bots that submit instantly |
| Rate limit | More than 5 submissions an hour from one sender (adjustable) |
| Duplicate text | The same message posted again within 24 hours |
| Banned senders | You ban a sender from the queue and their future posts are rejected |

Every message gets a risk score from 0 to 100. At 25 or more it is **flagged** and waits for you. At 60 or more it is **rejected** and kept out of your results. Both numbers are adjustable in the Settings tab.

Swearing alone is flagged, not rejected. A person describing a real frustration may curse, and you do not want to lose that voice. You decide.

Senders are never stored as addresses. The database keeps a short salted hash, so you can ban a repeat troll without knowing who they are.

### Grouping similar problems

When a response is approved, a trigger compares it with existing approved responses using two measures: spelling-level similarity (`pg_trgm`) and the share of meaningful words they have in common. A match in the same category gets a small bonus. If the best score reaches the threshold (default 0.30) it joins that group. Otherwise it starts a new one.

This catches problems described with similar words, for example "bus always late" and "buses never on time". It does not understand meaning, so "my commute is a nightmare" may not join a bus group. Fix these in the dashboard: move a response to another group, or merge two groups. Lower the similarity threshold in Settings to group more loosely.

The trigger scans up to 5,000 recent approved responses per insert, which is fine for a student project. If you outgrow it, the next step is embeddings with `pgvector`.

### Priority score

Each group is scored out of 100 from five things, weighted the same way as your original Problem Bank:

| Factor | Weight | Source |
| --- | --- | --- |
| Pain | x2 | average of what people said, 1 to 5 |
| Skill fit | x2 | you set this per group, 1 to 5 |
| How often | x1.5 | rarely 1, monthly 2, weekly 4, daily 5 |
| Would use a fix | x1.5 | yes 5, maybe 3, no 1 |
| Reach | x1 | 1 for one person, +1 for each doubling, capped at 5 |

## Setup (about 15 minutes)

### 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com), create a free project, and wait for it to finish starting.
2. Open **SQL Editor**, then **New query**.
3. Paste the whole of `supabase/schema.sql` and press **Run**. It is safe to run twice.
4. Optional: paste and run `supabase/seed_sample.sql` to load sample responses, including one flagged and one rejected troll message.

### 2. Make yourself an admin

1. In the dashboard open **Authentication**, then **Users**, then **Add user**. Enter your email and a strong password and tick **Auto confirm user**.
2. In the SQL Editor run this, with your email:

```sql
insert into public.admins (user_id)
select id from auth.users where email = 'you@example.com'
on conflict do nothing;
```

### 3. Connect the pages

1. In Supabase open **Project Settings**, then **API**.
2. Copy the **Project URL** and the **anon public** key.
3. Paste both into `js/config.js`.

The anon key is designed to be public. Row Level Security is what protects your data: visitors can only add a row, and cannot read, change, or delete anything. **Never put the `service_role` key in this project.**

### 4. Publish on GitHub Pages

1. Create a new GitHub repository and upload every file in this folder, keeping the folders.
2. In the repository open **Settings**, then **Pages**. Under **Build and deployment** choose **Deploy from a branch**, pick `main` and `/ (root)`, and save.
3. After a minute your site is live at `https://YOUR-USERNAME.github.io/YOUR-REPO/`.
   - Share `index.html` (the root address) with people.
   - Keep `/admin.html` for yourself. It needs your login, and it asks search engines not to index it.

### 5. Try it

1. Open the public form and send a test problem.
2. Open `/admin.html`, sign in, and watch it appear in a group.
3. Send something rude from the form and find it in the **Moderation** tab.

## Using the dashboard

- **Groups** shows similar problems grouped and ranked. Rename a group, set status and skill fit, mark the skills it needs, add notes, and open **What people said** to read the original responses. Move a response or merge two groups when the automatic grouping is wrong.
- **All responses** searches everything that passed the filter.
- **Moderation** holds flagged and rejected messages. Approve a good one and it joins the right group. Ban a repeat troll with one click.
- **Plan** turns your top groups into next steps, a roadmap, a skill-gap chart, and a Markdown export for your notes or portfolio.
- **Settings** tunes the thresholds, edits the blocked word list, manages banned senders, and can rebuild all groups.

## Finding the people

Regular people will not find a form on their own. Some ideas that work for student research: print a QR code for the form and put it where the problem happens (bus stops, offices, markets, clinics); ask family and neighbors to share it in their group chats; and interview three or four people in person, then enter their answers yourself so you hear from those who would never use a website.

## Privacy and ethics

- The form asks for consent and requires people to be 18 or older.
- Email, age range, and region are optional and visible only to admins.
- If you use this for a school project, check whether your school needs ethics approval for collecting data from people, and keep your consent text accurate to what you really do.
- To delete one person's data on request, delete their row in the **Table Editor**.

## Removing the sample data

Run this in the SQL Editor:

```sql
delete from public.submissions where is_sample;
delete from public.clusters c
where not exists (select 1 from public.submissions s where s.cluster_id = c.id);
```

## Files

```
index.html            public form
admin.html            private dashboard
css/styles.css        styles for both pages
js/config.js          your Supabase URL and anon key
js/common.js          Supabase client and small helpers
js/moderation.js      friendly checks in the browser
js/form.js            public form logic
js/admin.js           dashboard logic
supabase/schema.sql   tables, security rules, troll filter, grouping, ranked view
supabase/seed_sample.sql   optional sample responses
```

## Ideas for later

- Embeddings with `pgvector` and an Edge Function, for grouping by meaning instead of wording.
- Cloudflare Turnstile on the form, verified in an Edge Function, for stronger bot protection.
- A weekly email digest of new top groups.
- A public page that shows the top problems back to the people who contributed.
