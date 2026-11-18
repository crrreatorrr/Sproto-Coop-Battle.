# Authored boss effects

Boss FX are optional presentation clips in
`CoopBossTransformations.animations.bosses[key].phases[phase].fx`.
No new source art is registered by the playback implementation. Existing
four-row projectile sheets remain the fallback until provider-generated art
passes import and visual review.

Each named purpose uses the shared `CoopSpriteTimeline` clip format:

```js
fx: {
  signature: {
    cell: [96, 96],
    anchor: [48, 48],
    // Optional for signature/special only, after whole-cel contact alignment:
    // grounded: true,
    frameTicks: [6, 6, 6, 6],
    pages: [{
      src: 'assets/bosses/03-mudline-crapto-p2-projectiles.png',
      columns: 4, rows: 8, frames: 4, firstCell: 16
    }]
  }
}
```

Use the pinned phase `proj` path when replacing an accepted existing sheet.
The example uses Crapto's P2 path. The atlas may also be an
eight-by-eight provider sheet with eight frames per row, or use explicit `cells`
and multiple pages; timing is independent of column count. A clip contains at
most 64 frames. Cells must be 96 square, anchors must lie inside the cell, and
the whole cell is drawn. Pages are limited to 2048 pixels per side and 8 MiB
decoded each. Durations are positive integer simulation ticks (60 ticks/second).

| Purpose | Authoritative snapshot source | Playback |
| --- | --- | --- |
| `lane` | Boss projectile, `r` other than 1 or 3 | Loop from projectile `t` |
| `spread` | Boss projectile, `r === 1` | Loop from projectile `t` |
| `homing` | Boss projectile, `r === 3` | Loop from projectile `t` |
| `impact` | `bossImpact` event, `sm !== 70` | Clamp from event `t`; ends at 24 |
| `signature` | `bossImpact` event, `sm === 70` | Clamp from event `t`; ends at 24 |
| `special` | `bossSpecialImpact` event | Clamp from event `t`; ends at 36 |
| `hurt` | Living boss `fl > 0` | Clamp from `6 - min(6, fl)`; ends with flash |
| `death` | Boss `st === 'dead'` | Clamp from boss `t`; ends when owner is removed at 151 |

The conventional eight-row order is the table order. Descriptors explicitly
locate their cells, so the renderer does not assume that physical arrangement.
Short finite clips hold their final cel until the existing simulation lifetime
ends. Projectiles loop only their visual clip. Projectile positions, depth,
elevation, velocity, collision, damage and effect lifetimes are unchanged.

Signature/special clips may opt in with `grounded: true`. Their visual anchor
then draws at `FLOOR_TOP + event.y`, independently of `event.z`. Align each
whole source cel to a common opaque contact row before enabling it; for a
96px cell whose last opaque row is94, anchor `[48,95]` places that contact edge
exactly on the belt floor at every effect size. Origin alignment must preserve
all source opaque pixels and prove zero clipping. Other purposes ignore this
flag. Missing/false flags, undecoded or invalid clips and legacy fallback keep
their existing elevated origin. The simulation event's z and collision data
are never changed.

The pure selector reads the owner index and phase carried by each projectile
or effect. It never classifies an impact using the current actor state: a P1
shot can land while its owner is transforming into P2, and delayed impacts can
outlive their firing action. There is no client animation clock or retained
image from a different event. A decoded late page draws the cel at the current
serialized age, including after a restart/export/import reconnect.

The pinned `bossHit` event does not carry phase, and random death `boom` events
carry neither phase nor boss identity. Their existing rendering stays intact.
Optional hurt/death clips are attached overlays selected from the boss's own
serialized phase and flash/death ages. A transformation suppresses the hurt
overlay; a killing hit selects death rather than hurt. This avoids guessing an
event owner and preserves existing actor action playback.

Pages normally reuse `phase.proj`, so an eight-row replacement requires no
additional atlas request. Optional extra pages must use local lowercase
`assets/bosses/**/*.png` or `.webp` paths. Empty, `.` and `..` path segments,
remote paths and the reserved
`assets/bosses/actions/` and `assets/bosses/transformations/` namespaces are
rejected. Those namespaces have separate stream owners and eviction rules;
FX pages belong to the stage's `boss` bank. The loader includes valid optional
pages in the stage bank and deduplicates shared sources.

Missing metadata, unavailable lazy dependencies, pending decoding, dimension
mismatches and invalid clips retain the existing four-row atlas rendering.
Missing optional hurt/death clips simply add no overlay. New FX do not retain
an earlier event cel during a decode gap. Malformed paths are rejected before
the renderer requests an image.

`node tests/boss-fx.test.js` drives the actual pinned simulation through both
phase projectile families, all twelve signature/special zone programs, a P1
impact during transformation, simultaneous hurt/firing, finite death, and
restart export/import. It exercises the public world renderer with those
snapshots, validates exact source rectangles/placement/facing, eight-row and
explicit-cell atlases, finite clamp/projectile loops, late decode, path/resource
validation and four-row fallback. The test also checks that rendering leaves
the snapshots unchanged. Grounded cases verify exact contact-edge placement
across actual effect sizes, explicit-boolean opt-in, actor-independent origins,
legacy decode fallback, ignored flags on other purposes, and unchanged live
collision/event restart state.
