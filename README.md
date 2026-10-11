# Mod Manager for Anime Shop Simulator modders

A small local tool that keeps the **build / test / package / publish** state of all your MelonLoader mods in one place,
with a web page and a command line. It notices when a mod's source changed after it was tested or published, builds
and packages mods in bulk, and keeps your published list and to-do list up to date. Made by **Fabianens**.

Turkish guide: [README.tr.md](README.tr.md). The interface and command names are in Turkish for now
(*derle* = build, *paketle* = package, *yayınlandı* = published, *çalışıyor* = works).

## What it does

- **One state file** (`Files\mod_durum.json`) for every mod: version, stage, last build result, test mark, Nexus link, notes.
- **Stages:** New → Build → (try it in the game) → **Works ✓** → Package (zip in `Release\<folder>`) → **Published** + Nexus URL
  (the folder moves to `Yayınlanan Modlar`).
- **Change detection by content (SHA), not file dates.** When a source file changes, the test mark expires, a published
  mod shows as *updated* and its folder moves back to `Release`. Build output and files the game writes at runtime are ignored.
- **Bulk build / package** of the selected mods; unchanged mods and mods without *Works ✓* are skipped.
- **Requirements check:** reads the "Requirements" part of each package README (`ModMarket 1.4.0 or newer`) and warns
  when a required mod is not published or too old.
- Writes `NEXUS_YAYINLANANLAR.txt` (published list) and `YAYINLANACAKLAR.md` (waiting / updated list) from the state file.
- Will not build or package while the game is running.

## Folder layout it expects

```
Anime Shop Simulator\
  Mods\, UserData\, MelonLoader\       (the game)
  ModDev\
    Mods\<Mod>\                        one folder per mod: <Mod>.csproj (or derle.bat) and optional paketle.bat
    Release\<folder>\                  package zips (written by paketle.bat)
    Yayınlanan Modlar\<folder>\        published and unchanged packages
    Files\mod_durum.json               the state file
    Tools\ModManager\                  this tool (any folder two levels under ModDev works)
```

A different layout? Copy `config.example.json` to `config.json` and change the paths (relative to the tool folder),
your Nexus profile, author name or port.

- Build: `dotnet build <Mod>.csproj -c Release` when the folder has a csproj, otherwise `derle.bat nopause`.
- Package: runs the mod's `paketle.bat`; the zip folder is read from its `set OUT=..\..\Release\<folder>` line.

## Run

Needs [Node.js](https://nodejs.org) 18 or newer (no npm packages) and the .NET SDK for building mods.

```bat
Baslat.bat                      :: opens http://localhost:5170 (this computer only)
node mod.js yardim              :: command line help
node kurulum.js --dene          :: first run: preview the state file built from ModDev\Mods
node kurulum.js                 :: first run: write it
```

Common commands:

```bat
node mod.js liste                          :: all mods and their stage
node mod.js ekle <Folder> --ad "Name"      :: add a new mod
node mod.js derle <Mod>                    :: build
node mod.js calisiyor <Mod>                :: mark as tested in the game
node mod.js paketle <Mod>                  :: package
node mod.js yayinlandi <Mod> <nexus-url>   :: mark as published
```

When the web page is open, command line calls go through it (and show in its log); otherwise the command line does
the work itself. If you change the port in `config.json`, change it in `Baslat.bat` too.

| File | What it is |
|---|---|
| `core.js` | state file, content hashes, build / package / publish steps, reports |
| `mod.js` | command line |
| `server.js`, `index.html` | local web page |
| `kurulum.js` | creates the first state file from `ModDev\Mods` (run once) |
| `config.example.json` | optional layout and profile settings |

## Licence

MIT, see `LICENSE`. If you reuse the code, credit **Fabianens**.
