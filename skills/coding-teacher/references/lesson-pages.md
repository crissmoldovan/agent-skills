# Lesson pages

How to build an illustrated lesson page: a short course, one page long, that takes a learner from
zero to reading the whole system map. Build one only when asked (S7). Start from the model B6
names — the project's own lessons page when it has one, so every new lesson looks like part of the
same course, and otherwise the carried template, `assets/lesson-page.html`, which has every part
below working and a made-up sample course to replace.

## Before writing

1. **Load the harness's page guidance**, if it has any — a design or diagramming skill, a page
   contract for published pages. Its rules on title, theming, libraries, size and phone layout
   apply on top of these.
2. **Plan the course from the repository**, not from memory: list the components from the
   manifest, the folder layout, the deploy config, the services the code calls and the people who
   use the system. Read each before it goes on the page (H3).
3. **Settle the scope with the learner** when it is unclear: one concept as one lesson, a short
   series, or the whole system.
4. **Draw the map first.** Every component, every line between them, and for each the lesson that
   introduces it. The map is what the course builds towards; the lessons are its pieces in order.

## The course

**One plain question per component**, in the learner's words: *What happens when you open a
website?*, *What is a database?*, *Where does the code live?*, *What is a background job?* Not
*Understanding the persistence layer*. A question tells them what they will be able to answer.

**Order from what they touch, outward.** Start with what the learner sees and does — the page, the
screen they use — then what that talks to, then what that depends on, then how changes reach it.
Each lesson may use only words earlier lessons explained.

The page, top to bottom:

| Part | Content |
| --- | --- |
| Lesson bar | Sticky: a dot per lesson that follows the reader as they scroll, a count of quick checks answered right, and the **Pause motion** button |
| Hero | What the course covers, how long it takes, *no experience needed*; how each lesson works; and the **whole map**, with a caption that admits it looks like a jumble now and promises they will read every box by the end |
| Lessons | One per component, below |
| The big picture | The finished map with whole journeys travelling across it, step by step, and a final check |
| Glossary | Every word the course introduced, **one line each**, alphabetical, each linking to its lesson |
| Footer | How to go further — ask the coding teacher, read the library (B3) — and what the facts were checked against, with the date; a note that example data in the pictures is illustrative |

## One lesson

Every lesson has the same parts in the same order, so the learner knows where to look:

| Part | Content |
| --- | --- |
| Kicker | *Lesson 3 of 8* |
| Title | The question, in the learner's words |
| New words | Chips for each term this lesson introduces, and no others |
| Picture | An inline SVG on the dark panel, with a caption of one or two sentences saying what moves and why |
| Short answer | One or two bold sentences. If they read nothing else, this is enough |
| More | Two short paragraphs. Each new word in bold, explained where it appears |
| Pair | *In their terms* (the comparison, with where it stops) beside *In this project* (real names and paths) |
| Quick check | One question, three options, feedback for right and wrong that says why |
| Map so far | The system map up to this lesson, with the new piece lit, and one line saying what is new |

**One idea per lesson.** If the picture needs more than a sentence or two of caption, or the short
answer needs a third sentence, split the lesson.

## The big picture

The last lesson shows the finished map and two or three **journeys** across it — *a visitor reads
a page*, *a member of staff does the main task*, *someone changes the code*. Each journey is a list
of short steps; the current step lights its boxes and sends a dot along its line. The reader can
pick a journey, pause, step forward, or click any step. End with a final check that needs the whole
map to answer, such as *why can't visitors see the thing you added yesterday?*

## Visual language

- **Panels.** Pictures sit on a dark panel in light and dark themes alike, so the highlight colours
  read the same everywhere. Each colour has one job across the whole course:

  | Role | Used for |
  | --- | --- |
  | Subject | The thing this lesson explains |
  | Flow | Data, requests and anything moving |
  | Pick | A selected row or item |
  | OK | Success, *live*, allowed |
  | No | Refused, not allowed, failed |

- **Dress it in their world where that helps.** The panel and colours can borrow from the learner's
  field — a dark stage for people who work in theatres, a ledger page for accountants — as long as
  the roles stay fixed.
- **Fonts** that read easily at body size, with nothing thin; a monospace for labels, paths and code.
- **Light and dark.** Colours are tokens on `:root`, redefined for dark under
  `prefers-color-scheme` (guarded so an explicit light theme wins) and under an explicit dark theme.
  The body has its own background.
- **Phone width.** A 16-pixel side gutter; a wide picture scrolls sideways inside its panel, never
  the page.

## Motion

Motion shows the **mechanism** — a request travelling, a row being checked, a job leaving the
queue — and nothing else. A picture that would be as clear standing still stands still.

- **Restrained:** a few looping movements per picture, slow enough to follow, nothing that flashes.
- **Reduced motion is respected twice:** a `prefers-reduced-motion` media query stops every CSS
  animation and transition, and the script reads the same setting before moving anything itself.
- **Pause motion** in the lesson bar stops everything for anyone, whatever their setting, and says
  whether motion is on (`aria-pressed`).
- **Revealing sections as they scroll in** is optional, and never hides content from a reader whose
  script did not run: the hidden starting state applies only once the script has marked the page.
- Inline SVG and CSS only: no animation library, no video, no external script.

## Accessibility

- Every picture is an inline `<svg>` with `role="img"` and an `aria-label` that says what it shows;
  purely decorative ones are `aria-hidden="true"`.
- The caption says in words what the motion shows, so a reader who cannot see it loses nothing.
- Quick-check options are real buttons; feedback is announced and says why, right or wrong.
- Visible focus on everything that takes it; journeys' steps work from the keyboard.

## Content rules

- Every project fact is checked against the repository, exactly as for a chat answer (H3, H6).
- Comparisons match the mechanism and say where they stop (H5); one family across the course.
- Example topics, names and addresses in pictures are labelled as examples in the caption.
- What B7 excludes stays out of examples; no secret value appears anywhere, pictures included (H2).

## Handing it over

The finished page goes where B8 says: a private page where the harness publishes pages, or one
HTML file outside the repository, with its path given to the learner. Offer once to save it into
the project's library (B3) so the team has it; saving is a change to the repository, so it goes the
way B9 says, as its own task, and adds the page to the library's index.

## Checklist

- [ ] One plain question per component, in the learner's words, ordered from what they touch outward.
- [ ] Each lesson uses only words earlier lessons explained, and its new words are its chips.
- [ ] Every lesson has its picture, short answer, more, pair, quick check and map so far.
- [ ] The big picture has two or three journeys and a final check; the glossary has every word in one line.
- [ ] Every project fact was read in the repository this session; examples are labelled as examples.
- [ ] Motion shows a mechanism; reduced motion stops it in CSS and in the script; Pause motion works.
- [ ] Every SVG is labelled or hidden; quick-check feedback is announced.
- [ ] Light and dark both read; at phone width only pictures scroll sideways.
- [ ] No secret value and nothing B7 excludes, anywhere on the page.
