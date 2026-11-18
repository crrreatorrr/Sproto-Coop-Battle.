# Independent Zephyr P2 single-bank integration review — PASS

The staged 384×768 bank is ready for installation after the separate budget-policy checkpoint. Its top sixteen 96px cels are exact decoded RGBA copies of the committed projectile bank; its bottom sixteen are exact copies of the accepted V3 effects. No source art, game file, connected browser or provider job was changed by this review.

## Frozen scope

- Runtime: `fbf1ad90e749bb9a8c5bcfa51d6c5edce906eebc`.
- Bank SHA256: `13acc4990e93d439150588946121a39bde578bb49fd61bbbbe43797de1f01043`.
- Existing path: `assets/bosses/04-ranch-zephyr-p2-projectiles.png`.
- Signature/special/hurt/death source-cell offsets: 16/20/24/28, four cels each, columns 4, rows 8, cell 96. Ticks are respectively `[6,6,6,6]`, `[9,9,9,9]`, `[2,1,1,2]`, `[38,38,38,37]`. Only signature/special have `grounded:true` and anchor `[48,95]`; hurt/death use `[48,48]`.
- Decoded bank size 1,179,648 bytes, increase 589,824 bytes. This report does not certify the global asset budget; root/Bront own that checkpoint.

## Actual simulation and renderer evidence

A fresh disposable `git archive` of the runtime was replayed in private headless Chromium. The oracle used the accepted V3 external page; the candidate used only the single existing bank path. All 624 actual Sim snapshots produced byte-identical scene PNGs. Separate direct calculations checked 794 authored canvas draws against snapshot age, selected source cells, anchors, world positions and screen shake; all matched. 474 grounded signature/special draws use the attack-zone floor contact. Every family reached all four cels in both actual owner facings and released completely at its finite end.

Real signature/special zones, attached hurt/death, simultaneous special + hurt + original projectile rows, and a P1 projectile impact surviving its owner's P2 transformation all passed. Export/import reconnect snapshots were exact. The event's recorded phase controls old-projectile fallback, rather than the owner's current phase. Generic unowned death booms may remain after the authored death clip ends; they are existing legacy effects.

Loading requested the existing bank once and no extra effects-bank URL. Startup/all/stage path groups were unchanged; the merged existing path deduplicated. Invalid metadata, invalid dimensions, reserved path aliases, a stale four-row image and a pending decode all retained exact legacy fallback. Late decode selected the current event age, without restarting the clip. Advancing through later stages released the old bank.

All four native scene-contact boards were visually reviewed: source silhouettes remain complete, signature/special contacts follow their zones, both facings and all four stages play in order, and authored effects end. Boards are explicitly 50% nearest-neighbor summaries; all 624 full 640×360 scene PNGs and complete draw/snapshot logs are retained in `attempt-2/`.

## Reproduction and audit limits

Run `node check-single-bank.cjs /ABS/NEW-EMPTY-OUTPUT` from this folder, the independently frozen `check-draw-proof.cjs` checks the archived `attempt-2/` evidence. For a new independent draw check, use a separate copy and explicitly point its `RUN` constant to the new evidence directory; it does not accept a CLI output argument. The harness archives the pinned runtime, copies the staged sources to temporary public trees, and removes those trees after its run. It does not use the live connected Chrome. Inputs are bound by `input-hashes.json` and final `input-readback.json`.

`attempt-1/` is deliberately preserved. It passed pixel equivalence, but its hurt-right fixture let the idle AI turn left; it is not both-facing coverage evidence. The corrected test positions three teammates on the requested-facing side and asserts actual hurt/death owner facing. This fixture-only change produced the complete `attempt-2/` pass; no game fix was needed. A generic config-driven replay entry point will be additive, leaving this tested Zephyr proof unchanged.

The actor sheets are the committed legacy actors. This proves effects packing/integration, not admission of unfinished new combat body/gait/projectile art. The rejected new projectile02 source is not registered. Installation, release-version/cache handling and the global budget gate remain root-owned.
