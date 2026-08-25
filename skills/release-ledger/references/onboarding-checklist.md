# Release ledger — stack investigation checklist

A bounded investigation. Answer every line, write the answers into
`docs/release-ledger/implementation.md`, and stop. This is not an invitation to
read the codebase; each question exists because a specific later decision depends
on it.

Mark anything you cannot answer as an open question with a named owner. An honest
gap is cheaper than a guess that a migration is written against.

## 1. Shape of the application

| Question | What the answer decides |
|---|---|
| Which framework and major version serves HTTP? | Where the capture endpoint and the popup endpoints live, and what the route signature looks like. |
| Is there a server/client component split? | Whether audience filtering can happen in the same file as rendering. |
| Where do shared server utilities live? | Where the ledger's query helpers go so both the popup and the digest use one copy. |
| Is there an existing docs directory? | Where `implementation.md` belongs. |

## 2. Data

| Question | What the answer decides |
|---|---|
| Which database, and which client is used from server code? | The schema dialect and the connection idiom for every ledger query. |
| Where do migrations live, and what is the file naming rule? | Where the ledger migration is written and how its version is stamped. |
| Is there a review or staging step before a migration applies? | Whether you may create the tables yourself or must hand the file over. |
| Does the database enforce row-level access, and is it on by default for new tables? | Whether the ledger tables need policies, grants, or neither. |
| Which client does *privileged* server code use, and does it bypass row-level access? | Whether the digest job can read every entry while the popup endpoint cannot. |
| Is there a helper for reading a large result set in pages? | Whether the analysis and backfill jobs can select the whole queue at once. |

## 3. Scheduling and background work

| Question | What the answer decides |
|---|---|
| What runs background jobs, and how is a job registered? | Where the analysis and digest jobs live and how they are discovered. |
| How is a recurring schedule declared, and does it support a timezone? | Whether "nightly at 09:30 local" is expressible or must be computed in UTC. |
| Is there a batch-trigger primitive, or only one-at-a-time dispatch? | Whether analysis fans out or must chunk manually. |
| How does a job report failure, and what does the runner do with it? | Whether a failed digest is visible or silently swallowed. |
| Is there a registry of job identifiers that new jobs must join? | Whether registration is a second step people forget. |

## 4. Identity and permissions

| Question | What the answer decides |
|---|---|
| What is the user table, and what is its primary key type? | The foreign key on the dismissal watermark. |
| How does a server route learn the current user? | The popup and dismiss endpoints' first line. |
| How are roles or groups represented, and can they be read server-side? | How announcement audiences are expressed and enforced. |
| Is there an admin area with its own access rule? | Where the announcement composer goes. |
| Does the project have a test that asserts every route checks authorization? | Whether new endpoints must follow a specific shape to pass it. |

## 5. Delivery surfaces

| Question | What the answer decides |
|---|---|
| Is there a chat integration, and what helper posts a message? | Whether the digest reuses an existing poster or needs one. |
| Does that helper take markdown, or a block format? | Whether the digest converts, and where the converter comes from. |
| Is there a per-message size or block-count limit? | Where the "and N more" truncation tail is applied. |
| How are recipients addressed — channel, or per-user? | Whether the digest is one post or a fan-out, and how many users a fan-out would miss. |
| Is there an existing table recording outbound sends, and can it accept a row that is not tied to something else? | Whether the ledger needs its own send table. |

## 6. Existing inbound events

| Question | What the answer decides |
|---|---|
| Is there already an endpoint receiving forge webhooks? | Whether capture extends an endpoint or adds one. |
| Does it verify signatures, and how? | Whether the `github-webhooks` skill is an adoption or an audit. |
| Which events are already subscribed? | Whether the hook configuration needs changing at all. |
| Does the existing handler filter events before doing work, and how many does it discard? | Where capture hooks in. Measure this; do not assume. |
| Is that endpoint exempt from the project's authorization rules? | Whether capture inherits the exemption and the new popup routes do not. |

## 7. Rendering

| Question | What the answer decides |
|---|---|
| Is there an existing markdown renderer in the UI? | Whether entry rendering reuses it. |
| Does it allow raw HTML? | Whether it is safe for text derived from change bodies. |
| Is there a typography or prose stylesheet, and is it actually installed? | Whether markdown needs an explicit component map to look right. |
| What dialog or sheet primitive exists? | What the popup is built from. |
| Where is the application chrome mounted? | Where the popup attaches so it appears on every authenticated page. |

## 8. Model access

| Question | What the answer decides |
|---|---|
| How does existing code call a language model from a background job? | The analysis job's call site and its error contract. |
| Is there a prompt or template registry? | Whether the analysis prompt is code or data. |
| Is structured output supported, and with what schema mechanism? | Whether the `describe-changes` contract can be enforced by the model or must be validated after. |
| Is there cost logging? | Whether the backfill estimate can be checked against reality afterwards. |

## Completion gate

The investigation is complete when every row above has an answer or a named open
question, and `docs/release-ledger/implementation.md` contains a section per
system-model stage naming the concrete file, table, schedule, or helper that will
carry it. Nothing is built before that document exists.
