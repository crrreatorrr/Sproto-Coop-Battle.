# Unused UFO art

`idle.png`, `muzzle.png`, `red-laser.png` and `thrust.png` used to sit in `public/assets/ufo/`, but
nothing in the game ever requested them (`npm run check:assets` listed them as unused). They were
moved here so they stay in the repository without shipping in `dist/`. The UFO pickup draws only
`cockpit-front`, `cockpit-rear`, `laser`, `beach-ball` and `shield1`–`shield4`.
