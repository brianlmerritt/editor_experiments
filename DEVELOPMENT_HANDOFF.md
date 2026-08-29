# Development handoff between computers

Margin Note has four different kinds of state. They must not be treated as one
backup or moved by copying an arbitrary application directory.

| State | Authority | Transfer mechanism |
|---|---|---|
| Source code and design decisions | Git repository and checked-in Markdown | Commit/push, then clone or fetch on the other computer |
| A writer's Margin Note project | Current Svelte workspace state exported through the facade | Compact `<project-name>.mnote.zip` export and validated import |
| Codex development conversation | The Codex chat/thread on its originating host | A reviewed, read-only shared-thread snapshot plus this repository documentation |
| Provider credentials and device settings | Device-local provider settings | Configure them again on the destination computer |

This separation is intentional. Neither the Git repository nor a project archive
contains API keys. A source checkout also does not contain the SQLite project data,
browser recovery mirrors, or the originating Codex task.

## Durable development memory

Do not rely on one long Codex conversation as the project specification. Codex
defines local chats as work running on their computer and memories as locally stored
context. Its project guidance recommends keeping durable instructions in checked-in
documentation so future chats can recover them. See the official
[Codex projects and chats guidance](https://learn.chatgpt.com/codex/projects).

The following files are the durable starting set:

1. [README.md](./README.md) — current implemented surface and verification commands.
2. [ARCHITECTURE.md](./ARCHITECTURE.md) — Svelte source-of-truth and domain rules.
3. [SVELTE_POLICY.md](./SVELTE_POLICY.md) — mandatory Svelte 5 Runes policy.
4. [FACADE_V1.md](./FACADE_V1.md) — application/facade ownership boundary.
5. [NAVIGATION.md](./NAVIGATION.md) — Spine, Material, Todos, relationships, and Navigator behaviour.
6. [AI_BOUNDARY.md](./AI_BOUNDARY.md) — AI requests, Writing Context, recovery, proposals, and adoption.
7. [PROJECT_TRANSFER_V1.md](./PROJECT_TRANSFER_V1.md) — native project export/import contract.
8. [RETENTION_AND_COMPACTION.md](./RETENTION_AND_COMPACTION.md) — revision retention and garbage collection.
9. [PLAN.md](./PLAN.md) and [CRAFT_REVISION_QA.md](./CRAFT_REVISION_QA.md) — deferred work and verified editor behaviour.

Conversation is useful historical evidence, but checked-in design documentation wins
when the two conflict. A shared Codex thread snapshot is read-only and does not update
as work continues. Review it before sharing because paths, prompts, and tool output may
contain private information.

Suggested first prompt on the destination computer:

> Continue development of Margin Note from this repository. Read README.md,
> ARCHITECTURE.md, SVELTE_POLICY.md, FACADE_V1.md, NAVIGATION.md, AI_BOUNDARY.md,
> PROJECT_TRANSFER_V1.md, RETENTION_AND_COMPACTION.md, PLAN.md, and
> CRAFT_REVISION_QA.md before proposing changes. Treat those files as authoritative
> where conversation and documentation differ. Also read the supplied previous-task
> snapshot as historical context. Inspect the working tree and run the existing
> checks before editing. Do not create branches, commit, push, pull, or otherwise
> alter Git state unless I explicitly request it.

## Moving development to Windows

Use a normal local NTFS directory such as `C:\dev\margin-note`. Avoid placing the
working checkout or `node_modules` inside OneDrive, a synchronised folder, or a
cross-device symbolic link. Git should move source history; OneDrive should not act
as a live source-tree synchroniser.

Requirements: Node.js 22 or newer and npm.

After cloning or checking out the intended branch:

```powershell
npm install
npm run check
npm test
npm run dev
```

`npm install` generates `.svelte-kit/tsconfig.json` through the normal SvelteKit
prepare step. The generated `.svelte-kit` directory and `node_modules` are local build
artefacts and must not be copied from macOS.

## Moving writing projects

For each writing project that matters:

1. On the source computer, use **Export project** to create the compact
   `<project-name>.mnote.zip` archive.
2. Move that archive through a reliable transfer medium.
3. Start Margin Note on the destination computer.
4. Use **Import project…**, inspect the preview, and create the imported project.
5. Verify its Spine, Material, relationships, Todos, documents, Inputs, and action
   definitions before deleting the source copy.

Do not copy `data/writing-ledger.sqlite` as the normal migration procedure. It is a
server-instance store, whereas `.mnote.zip` is the validated, remapped, portable
project boundary. Do not use the forensic archive for ordinary transfer.

## Credentials and local configuration

Provider profiles live in ignored `data/provider-settings.json` and are deliberately
excluded from Git and native project export. Recreate OpenRouter, OpenAI, Anthropic,
Ollama, Codex / ChatGPT, or compatible-provider profiles on Windows and enable **Use**
explicitly. The Codex profile contains no secret; install the Codex CLI and complete
its local ChatGPT sign-in separately on that computer.
Project-owned action definitions do travel in `.mnote.zip`; credentials and device
participation state do not.

## Source-computer checklist

- Confirm the intended branch and inspect the working tree.
- Run `npm run check` and `npm test`.
- Commit and push source/documentation changes through the normal human-controlled
  Git workflow.
- Export each required writing project as a compact `.mnote.zip`.
- Create and save a reviewed read-only snapshot of the relevant Codex task.
- Transfer archives without relying on the problematic live OneDrive/symlink path.

## Destination-computer checklist

- Clone into a local NTFS development directory.
- Install dependencies locally and run the checks.
- Add the folder as a local Codex project and start a new task with the handoff prompt.
- Supply the previous-task snapshot for historical context.
- Import the required `.mnote.zip` archives.
- Re-enter provider credentials and verify provider URLs, protocols, and models before
  making a paid request.
