# Alert sounds

Put your own `.wav` files here. `npm run addon` copies them into ATAS's Sounds folder (or, if that folder isn't
writable, into `%LOCALAPPDATA%\RoninFlow\Sounds`, which the RoninFlow Suite indicator also plays from), so they show up
in the indicator's sound pickers.

The indicator's default sounds are `female_order filled` (entries and scale-ins, built into ATAS), `Noice` (win),
`Nope` (loss), `Not_Leavin` (profit target), `Here_We_Go_Again` (daily loss limit) and `Aint_Got_Time_To_Bleed`
(loss-limit warning). If a file with that name isn't installed, a built-in ATAS alert plays instead.

The `.wav` files themselves aren't part of the repository (`.gitignore`), so clips you don't have the rights to share
stay on your computer.
