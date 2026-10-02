# Pointing at the screen

A question about something a reader sees has to show it. Described in words, "the second
sentence under the chart" is a different sentence to every reader, and the answer comes back
about the wrong one. A shot with a box around exactly that thing, and a label naming the
question, settles which one is meant before anyone answers.

This page is what any renderer bound as B4 has to do, and what the run checks before a shot
goes. It covers only the open questions: shoot after the hunt-down pass (S2), never before,
because a question that is then answered here leaves the brief and its shot is wasted.

## What a shot is

- **Two images per target.** An overview: the whole width of the screen, with the box, so the
  reader can find the thing on their own screen. And a close-up: cropped around the box, with
  enough around it to read in place (the heading above it, the row before it).
- **A box around exactly what is asked**, and nothing wider: the sentence, not its paragraph;
  the row, not the table. A question about several things gets a box for each.
- **A label naming the question** by its number and a few words, such as `Q7 · the band names`.
  A label that covers its own target fails the shot. A label over other text is allowed, but
  look at it.
- **The file name carries the number and the variant**, such as `Q7-narrow.png` for the
  close-up and `Q7-narrow.screen.png` for the overview, so the brief, the ledger and a reply
  all point at the same image.
- **Attached at every depth.** Brief and normal depth are otherwise transcript-only; a shot is
  the exception, and the header says how many travel. Where the channel carries text only, the
  brief says where the shots are, and the answer sheet still stands on its own (H2).
- **The words say where it is as well**: the path a reader follows to reach it — the screen, the
  tab, the panel — so they can find it on their own copy.

## What is recorded beside the images

The renderer writes one record per round, and the brief is built from it:

- the build: its commit, and whether the checkout had local changes;
- when the shots were taken;
- per shot: whether it was written, and the exact text inside each box, so the brief quotes
  what is boxed rather than what someone remembers;
- every host the page tried to reach and could not. The expected ones are known; a new one is
  worth a look.

The brief is built only from shots that passed, of the pinned commit. A shot that failed, a shot
missing from the record, or a shot of another commit is refused, not patched round. Keep the
shot specifications and the record with the round's other files, not in a temporary folder: they
are how the next round shoots the same things again.

## Render a pinned build, on this machine

- **Pin the build the reader will look at**: the commit the release they saw was made from, read
  from that release's own record. Never a branch head, which moves until the shots no longer
  match what was released, and never what a live site reports about itself, because reading the
  live site is what this method avoids.
- **Check that commit out on its own**, for example with
  `git worktree add --detach <dir> <commit>`, and render from there. A renderer that is given a
  checkout at any other commit refuses it.
- **Serve it on this machine.** Never shoot a live, staging or production site, and never a
  signed-in session: a signed-in page shows the shooter's own state rather than the reader's,
  and a live page can write to shared data while it is being driven.
- **Block every other host.** Only the served origin resolves. Fonts and scripts from a CDN,
  analytics and every database stay unreachable, and the page renders without them. Letting
  one through "because the page looks wrong" is how data leaves the machine.
- **Shoot again in every round.** A question carried into a later brief is shot again at the
  build the reader now sees, and its words say what is on the screen now, not what was sent
  before.

## When the target is not found, the shot fails

- No image is written, and the run says which target it missed. **Never a whole-screen
  stand-in**: a missing image reads as "no evidence", and a whole screen in its place reads as
  evidence of the wrong thing.
- Fix a failed shot by changing how its target is found — a narrower selector, the first words
  of the sentence, a step that opens the panel first — never by editing the image, and never by
  dropping the box.
- A shot that has been sent is a record. Never overwrite it; a re-shoot is asked for by name.

## Open every image

A renderer that exits cleanly has drawn a box somewhere. Only looking says it is the right
somewhere. Before anything goes, open each image and check that:

- the box holds exactly what is asked, and nothing else;
- the label names the right question and covers nothing it points at;
- the overview, or the close-up's surroundings, shows where on the screen it is.

## Every variant the question applies to

A screen that exists in several variants — two categories of data, two layouts, two regions,
two roles — is shot in every variant the question applies to. Shot in one, it reads as a
question about that one only, and half the answer is missing. Where the variants number or name
things differently, the brief says whose numbering it uses.

## What is not shot

- **A state only a signed-in reader sees**: their account, their saved items, their own
  history. A renderer that cannot sign in is the safe one, so describe the state in words, say
  why there is no shot, and tell the person bound as B1.
- **A question with nothing on the screen to box.** It gets no shot, and no whole-screen
  stand-in. Its detail says so.
- **Anything, when there is no renderer.** With no browser automation in this environment, and
  none named when the run asks (B4), no question is shot. Each one says in words where to look,
  the header says that no shots travel, and the brief is otherwise the same.

## What the shooting reveals

Shooting is often the first time anyone looks at every point the questions name, on the build
itself. When it shows something that disagrees with a record — a stale figure, a defect, a
question the screen already answers — that is not fixed, and not quietly rewritten into the
question. It goes to the person bound as B1 as a finding, with the shot and the record it
contradicts (H5), and the question goes back through the hunt-down pass: it may now be answered
here, or need different words.

## Checklist

- [ ] Only open questions were shot, after the hunt-down pass
- [ ] The build is pinned to the commit the reader saw, and the record names it
- [ ] Nothing was rendered from a live site or a signed-in session, and every other host was
      blocked
- [ ] Every failed shot was fixed by changing how its target is found, or reported as missing;
      none was replaced by a whole screen
- [ ] Every image was opened, and boxes exactly its target under a label naming its question
- [ ] Every variant the question applies to has its shot
- [ ] Every signed-in state is described in words, and said to be unshot
- [ ] Every finding the shooting revealed is with the person bound as B1, not fixed
