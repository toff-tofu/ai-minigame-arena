# AI Minigame Arena

Train an AI by playing with it, send it into short matches against other players’ AIs, and watch the replay to see what it learned. The first game is a block-stacking duel. The first prototype is a local two-player terminal duel.

## Run the prototype

Use Node.js 24 or newer. The prototype uses Node’s built-in TypeScript support and has no packages to install.

```sh
npm test
npm run play
npm run play -- 42
```

Two players take turns at the same terminal. Enter a column from 1 to 9 and one of the four rotations in degrees, for example `3 90`. The column is the left edge of the rotated piece. The game shows all four rotations before each turn, with the boards and scores side by side. Enter `q` to quit. Pass a seed to replay the same piece sequence, or omit it to draw a new one.

## What makes it a game

Players are coaches as well as competitors. A good match ends with a decision the player can understand and a reason to try a different approach.

1. Watch your AI stack against an opponent.
2. Pause the replay at a placement that changed the outcome.
3. Enter a private session to play a duel yourself or demonstrate a different move from that position.
4. Watch a new match and see whether your AI makes a different choice in a similar situation.

Two AIs can be competitive and still feel different. One might use extra blocks to build a wide base. Another might stack quickly and accept more risk. Show those habits through moves and outcomes players can verify in replays.

## First minigame

Build a turn-based, side-by-side stacking duel with an integer grid. Each competitor has a separate board and gets the same piece sequence. A turn consists of selecting a legal column and orientation, then dropping the piece vertically until it hits the floor or an occupied cell. Use a small set of original block shapes.

| Rule | Starting proposal |
| --- | --- |
| Board | 9 columns by 16 rows |
| Match length | 12 placements per competitor, or until that competitor busts |
| Stability | Each newly placed shape has at least half its underside cells supported. An underside cell has no cell from the same shape directly below it. At every horizontal cut, each connected mass above the cut must have its horizontal center of mass between its outermost support contact edges. Treat grid cells as equal mass. |
| Bust | A player busts if a piece overflows the board or a placement fails a stability check. The opponent finishes their remaining turns. |
| Score | Highest stable height reached. A competitor that finishes without busting beats a competitor that busts. Equal outcomes and scores are a draw. |
| Invalid input | Out-of-range columns and invalid orientations are rejected without advancing the turn. A geometrically valid drop may still bust. |

For the center-of-mass check, consider only connected components above the current cut, using edges for connectivity. Each contact is the bottom edge of a cell touching a filled cell directly below the cut or the floor at row zero. Include separate unsupported components in the check. Compare doubled grid coordinates and integer sums to avoid floating-point boundary disagreements.

Start with slow turns, instant board updates, and a loss explanation such as “The new block shifted the tower’s weight past its support.” This grid model is a starting hypothesis. Tune it once a human can play a few dozen rounds and tell whether risky placements are understandable.

## How the AI learns

Start with a small, inspectable policy. For a given board, enumerate possible drops and score their resulting positions with features such as added height, support margin, and remaining placement options. A shared starter policy gives every player a usable AI. Each AI has a versioned set of learned weights layered on top.

Every completed match produces experience for the owner’s AI, even when it loses. For each move, store the pre-move board, available actions, the chosen action, and the resulting state. Use match outcomes to inform a small, bounded update to the policy. In the first trainer, use the discounted later change in stable height as a reward and apply a bust penalty. Compare the selected move with the other candidates through a softmax policy update. Training may improve the AI over time. Individual updates can be neutral or make it worse, so evaluate each candidate before promotion.

Private sessions offer two ways to train:

- **Play a duel.** Play directly against a frozen snapshot of your AI. The AI learns from its side of the completed duel.
- **Demonstrate a move.** Reopen a replay position, pick a legal drop, and submit it as an explicit coaching example. Update the policy to increase the weight it gives that move relative to the other choices in that position. Let players retry the position immediately to see which move it now selects.

The first implementation can run one update per batch of experience. Keep the training batch, the previous policy version, and the resulting policy version. Check the candidate on fixed boards and against baseline bots with held-out seeds. Start with guardrails for bust rate and match score. Track private practice separately from ranked results. During development, expose the most influential features behind a decision so the team can check explanations against the actual scoring.

## Code layout

Use TypeScript for the first pass so the simulator, trainer, tests, and replay UI can share types. The layout below includes planned modules.

```text
src/
  game/       Board state, drops, stability, scoring, seeded pieces
  ai/         Candidate features, policy scoring, learning, evaluation
  matches/    Match orchestration, events, snapshots, replay validation
  training/   Private duels, demonstrations, policy promotion
  ui/         Board, local controls, replay, coaching feedback
tests/        Rule fixtures, deterministic matches, training regressions
```

Keep the engine independent of the UI and of persistence. A state transition receives a state and an action and returns a new state and events. Use a single explicit seed for a piece sequence and a separate explicit seed for policy sampling. Freeze both policy versions at match start. Save the rules version, seeds, policy versions, accepted moves, and final outcome with each match so old replays can still be opened after training changes.

## Implementation order

1. **Make stacking playable locally.** Implement a pure board module with operations for listing drops, applying a drop, checking stability, and scoring. Add a tiny command-line driver with board rendering. Verify awkward placements by hand and cover them with fixtures.
2. **Run two bots head to head.** Add reproducible piece sequences, a basic policy, and a match runner. Play a few hundred seeded matches to gauge match length, ties, and bust rate. Compare simple baseline bots that optimize for height or stability.
3. **Make a replay people can read.** Render both boards and add step controls, a score, and a visible reason for a bust. Rebuild replays from validated moves. Let the player select a move in the replay as a practice starting point.
4. **Close the coaching loop.** Let a human play a private duel and demonstrate a move. Save both sources of experience, run the trainer, and show how a policy version scored the available moves before and after coaching.
5. **Add online matches after the server decision.** Start with asynchronous head-to-head matches. Queue two players, snapshot their policies, simulate the match, and make the result and replay available to both. Add a rating for stacking after results are recorded reliably.

Step 1 uses Node’s built-in test runner. Its fixtures cover ordinary floor drops, stable overhangs, busts, and completing a duel after one player busts.

## Data to carry into online play

| Record | Fields to start with |
| --- | --- |
| AI | Owner ID, display name, current policy version |
| Policy version | AI ID, parent version, weights, feature version, evaluation summary |
| Match | Mode, participant IDs, frozen policy versions, rules version, seeds, accepted moves, result |
| Training example | Owner ID, source match or session, board position, chosen action, outcome or demonstration label |
| Training update | AI ID, source example IDs, base version, candidate version, promotion state |

When online play arrives, trusted match execution should determine results and training credit. Apply each match’s training credit once per participant. If two matches finish around the same time, serialize policy promotion per AI or use a version check and retry against the newest policy. A private practice session should be accessible only to its owner. Define which online replays can be shared before making any public.

## How we’ll know the prototype works

- A player can finish a short local duel and understand which placement decided it.
- Identical rules, seeds, and inputs produce the same match and replay.
- A demonstration measurably changes the score assigned to the taught move, and a nearby held-out position checks whether the lesson transfers.
- Automated matches produce training examples and candidate policy versions that can be evaluated against fixed baseline bots.
- A failed candidate leaves the previous policy available, and replaying an old match still yields its original outcome.

## Server decision

The local milestones can run on one machine with in-memory state or local files. Choose a server once we have measured match runtime, replay sizes, training runtime, and how often players want to queue. At that point, decide where to store accounts and replays, how to execute background matches and training, and whether the UI needs live updates. Separate skill progression by minigame so chess, block stacking, and other future games can each use the rules and learning approach that fits them.

## Development status

The stacking engine and local two-player terminal duel are playable. The next milestone is reproducible bot-versus-bot matches.
