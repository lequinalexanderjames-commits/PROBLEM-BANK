-- Optional sample data so you can see grouping and the troll filter working before real people respond.
-- Run in the SQL Editor AFTER schema.sql. Every row is marked is_sample = true.
--
-- Expected result: about 6 groups (bus, electricity bill, repair people, medication, government paperwork, group projects),
-- one message held in the Flagged queue, and one in Rejected.
--
-- Remove it all later with:
--   delete from public.submissions where is_sample;
--   delete from public.clusters c where not exists (select 1 from public.submissions s where s.cluster_id = c.id);

insert into public.submissions (title, description, category, pain, frequency, would_use, location, consent, is_sample)
values ('The bus I take to work is late almost every morning',
        'I wait 20 to 30 minutes at the stop and have no idea if the bus is coming. Twice this month I was late to work because of it.',
        'Getting around', 4, 'daily', 'yes', 'North district', true, true);

insert into public.submissions (title, description, category, pain, frequency, would_use, consent, is_sample)
values ('Buses never come on time and nobody tells us',
        'There is no way to know where the bus is. I stand at the stop every morning and just hope it shows up on time.',
        'Getting around', 4, 'daily', 'yes', true, true);

insert into public.submissions (title, description, category, pain, frequency, would_use, consent, is_sample)
values ('Hard to find out when the next bus will arrive',
        'The timetable on the pole is wrong. I would pay for anything that tells me when my bus is actually coming.',
        'Getting around', 3, 'weekly', 'yes', true, true);

insert into public.submissions (title, description, category, pain, frequency, would_use, consent, is_sample)
values ('I never understand my electricity bill',
        'The charges are confusing and the amount changes every month. I cannot tell if I am being overcharged.',
        'Money and bills', 3, 'monthly', 'yes', true, true);

insert into public.submissions (title, description, category, pain, frequency, would_use, consent, is_sample)
values ('My electric bill is confusing and keeps changing',
        'I do not know why the amount goes up and down and there is nobody who can explain the charges to me.',
        'Money and bills', 3, 'monthly', 'maybe', true, true);

insert into public.submissions (title, description, category, pain, frequency, would_use, consent, is_sample)
values ('Finding a trustworthy plumber or electrician is hard',
        'I ask around in group chats and still end up with people who overcharge or never show up at the agreed time.',
        'Home and family', 3, 'monthly', 'yes', true, true);

insert into public.submissions (title, description, category, pain, frequency, would_use, consent, is_sample)
values ('Cannot find reliable repair people for my house',
        'Every time something breaks I spend days trying to find someone good who charges a fair price for the work.',
        'Home and family', 3, 'monthly', 'yes', true, true);

insert into public.submissions (title, description, category, pain, frequency, would_use, contact_email, consent, is_sample)
values ('My mother forgets to take her medicine',
        'She is 74 and takes four pills at different times of day. We call her several times a day to remind her.',
        'Health', 5, 'daily', 'yes', 'sample.person@example.com', true, true);

insert into public.submissions (title, description, category, pain, frequency, would_use, consent, is_sample)
values ('Hard to keep track of my father''s medicine schedule',
        'He mixes up the pills and sometimes skips doses. I live in another city and worry about him constantly.',
        'Health', 5, 'daily', 'yes', true, true);

insert into public.submissions (title, description, category, pain, frequency, would_use, consent, is_sample)
values ('Waiting all day at the city office to renew documents',
        'I took half a day off work and the line was so long that I had to come back on another day to finish.',
        'Government and paperwork', 4, 'rarely', 'yes', true, true);

insert into public.submissions (title, description, category, pain, frequency, would_use, consent, is_sample)
values ('Government paperwork takes too many visits',
        'Each office asks for a different paper and I keep going back and forth to get the same document stamped.',
        'Government and paperwork', 4, 'monthly', 'yes', true, true);

insert into public.submissions (title, description, category, pain, frequency, would_use, consent, is_sample)
values ('In group projects nobody knows who is doing what',
        'We split tasks in a chat but a week later no one remembers who agreed to do which part, so work gets doubled or missed.',
        'School and learning', 3, 'weekly', 'maybe', true, true);

-- Held for review (swearing alone is flagged, not deleted)
insert into public.submissions (title, description, category, pain, frequency, would_use, consent, is_sample)
values ('This stupid app keeps crashing and it is a piece of shit',
        'My banking app closes by itself every time I try to pay a bill, so I have to queue at the bank instead.',
        'Online and phones', 4, 'weekly', 'yes', true, true);

-- Obvious troll (rejected automatically)
insert into public.submissions (title, description, category, pain, frequency, would_use, consent, is_sample)
values ('this survey is stupid and u r an idiot lol',
        'you are a loser, nobody cares about your dumb project',
        'Other', 1, 'rarely', 'no', true, true);
