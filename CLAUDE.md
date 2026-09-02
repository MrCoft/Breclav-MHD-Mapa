<!-- ai-config:template start -->
Reuse first. Most functionality already exists — search the codebase for something similar before implementing anything new, and prefer extending what is there over writing new code.
Before adding a field or a branch, check whether the thing is expressible as data. Behaviour that only one case uses is usually data, not a branch.
Prefer one thing per file, named after the file. Many small files beat a few long ones.
Order code so it tells a story: what a reader meets first at the top, the complicated things after, the one-off and weird ones at the end. The same holds for tests.
Only comment very complicated code, non-obvious code, or something that is there to fix a cryptic bug. 95% of code needs no comment — good variable names and well-named methods buy more readability. Never add a comment explaining that a class was split or an interface created for testing reasons.
Validate input once, at the boundary. Core code never defends against bad data.
Run the project's full check — typecheck, lint and tests — before calling anything done.
Assert the setup, not just the behaviour. A negative test passes just as happily when the setup silently broke, so assert the arrange step or add a control arm that fails without the fix.
A test whose expectation is re-derived through the code under test cannot fail. Mutate the code under test and watch the assertion fail; if it does not, the test was never testing anything.
When you have a plan to execute, always use subagent-driven execution: a fresh subagent per task, reviewed between each. Never ask the user to choose between subagent-driven and inline execution — subagent-driven is the answer.
When you notice a bug, defect or suspicious behaviour that is not part of the current task, append an entry to `docs/known-bugs.md` before continuing — a short title, the date found and what you were doing, `path/to/file:line`, the problem, and the impact. Do not fix it and do not widen the current task. Add to an existing entry if the problem is already listed, and never remove entries; the user decides when a bug is closed.
Nothing resolved in conversation may exist only in conversation. Before the work is done, write down what was decided, what changed, and what is still open.
Record design and architecture decisions in `docs/decisions.md` as append-only numbered entries: what was decided, what was rejected, and why. Never edit or delete a past entry — supersede it with a new one.
Log unresolved questions in `docs/open-questions.md` rather than guessing or silently picking. Read it before starting a task and revise it when you finish.
Do not state counts or inventories in documentation that nothing verifies — they go stale silently and a number nothing checks is not information. Give the command that answers the question instead.
Running code generation yourself is fine and encouraged. Report which generated files changed, and keep generated output in its own commit where that keeps the history readable.
Committing is fine. You do not need to leave changes uncommitted for the user to review.
Never use if or any other blocks without braces, even for single-line statements.
When using Tailwind, the max "size" you can use is something like w-8. Bigger than that, do it using pixels (e.g. w-[100px]).
No re-exports. When an exported item is renamed, rename all its usages. Do not re-export it under the old name.
<!-- ai-config:template end -->
